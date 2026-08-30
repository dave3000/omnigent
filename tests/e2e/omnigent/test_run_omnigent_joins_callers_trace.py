"""Dispatching client's ``TRACEPARENT`` must be extracted.

A wrapper (the *dispatching client*) starts an OTel span, serializes its
W3C trace context into ``TRACEPARENT``, and invokes ``omnigent run``.
Cross-service tracing requires the run's telemetry to join the caller's
trace: at least one omnigent-emitted span must carry the caller's trace
id, so the dispatcher -> runner -> harness view is one trace instead of
disjoint traces stitched by out-of-band id joins.

Reproduction shape (mock LLM, in-test OTLP/HTTP collector):

1. Start an OTLP collector; point ``OTEL_EXPORTER_OTLP_ENDPOINT`` at it.
2. Mint a caller trace context and set ``TRACEPARENT`` in the env, as a
   wrapper with an active span would.
3. Run ``omnigent run hello_world.yaml -p ...`` with telemetry enabled.
4. Assert omnigent exported spans at all (rig sanity), then assert at
   least one of them rides the caller's trace id (the bug).

**What breaks if this fails:** the launch path never extracts the
dispatching client's ``TRACEPARENT`` (the ``run`` dispatch does not
bless it and ``trace_context_for_response`` does not consume it); every
omnigent span roots an omnigent-generated trace and the caller's
context dies at the server boundary.
"""

from __future__ import annotations

import gzip
import os
import secrets
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from tests.e2e.conftest import configure_mock_llm, find_free_port, reset_mock_llm

_MODEL = "mock-caller-traceparent-model"

_HARNESS = "openai-agents"

_PROMPT = "say hi in 5 words"

_RUN_TIMEOUT_SEC = 150

# How long to wait for BatchSpanProcessor flushes to reach the collector
# after the subprocess exits. Providers flush on shutdown; 15s is generous.
_SPAN_DRAIN_SEC = 15.0


class _OtlpTraceCollector:
    """Minimal OTLP/HTTP trace sink that records exported spans."""

    def __init__(self) -> None:
        self.spans: list[dict[str, str]] = []
        self._lock = threading.Lock()
        self._port = find_free_port()
        collector = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # http.server API name
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                if self.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                if self.path == "/v1/traces":
                    collector._record(body)
                self.send_response(200)
                self.send_header("Content-Type", "application/x-protobuf")
                self.end_headers()

            def log_message(self, *args: Any) -> None:
                pass

        self._server = ThreadingHTTPServer(("127.0.0.1", self._port), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def endpoint(self) -> str:
        return f"http://127.0.0.1:{self._port}"

    def _record(self, body: bytes) -> None:
        from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
            ExportTraceServiceRequest,
        )

        req = ExportTraceServiceRequest()
        req.ParseFromString(body)
        rows: list[dict[str, str]] = []
        for resource_spans in req.resource_spans:
            service = next(
                (
                    attr.value.string_value
                    for attr in resource_spans.resource.attributes
                    if attr.key == "service.name"
                ),
                "",
            )
            for scope_spans in resource_spans.scope_spans:
                for span in scope_spans.spans:
                    rows.append(
                        {
                            "service": service,
                            "name": span.name,
                            "trace_id": span.trace_id.hex(),
                        }
                    )
        with self._lock:
            self.spans.extend(rows)

    def snapshot(self) -> list[dict[str, str]]:
        with self._lock:
            return list(self.spans)

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()


def _summarize_traces(spans: list[dict[str, str]]) -> str:
    """Group collected spans by trace id for a readable failure message."""
    by_trace: dict[str, list[str]] = {}
    for span in spans:
        by_trace.setdefault(span["trace_id"], []).append(f"{span['service']}:{span['name']}")
    lines = []
    for trace_id, names in sorted(by_trace.items(), key=lambda kv: -len(kv[1]))[:12]:
        lines.append(f"  trace {trace_id}: {len(names)} spans, e.g. {names[:4]}")
    return "\n".join(lines)


def test_run_omnigent_joins_dispatching_clients_trace(
    omnigent_python: Path,
    omnigent_repo_root: Path,
    mock_credentials_env: dict[str, str],
    mock_llm_server_url: str,
) -> None:
    """
    ``omnigent run`` invoked with a caller ``TRACEPARENT`` in the
    environment must emit at least one span in the caller's trace.
    """
    reset_mock_llm(mock_llm_server_url)
    configure_mock_llm(
        mock_llm_server_url,
        [{"text": "Hello there nice to meet!"}],
        key=_MODEL,
    )

    collector = _OtlpTraceCollector()
    try:
        # The dispatching client's active-span context, serialized the way
        # a wrapper using TraceContextTextMapPropagator().inject would.
        caller_trace_id = secrets.token_hex(16)
        caller_span_id = secrets.token_hex(8)
        traceparent = f"00-{caller_trace_id}-{caller_span_id}-01"

        env = dict(mock_credentials_env)
        # Local SDK packages the spawned server/runner import; harmless
        # when they are already installed in the interpreter.
        extra_paths = [
            str(omnigent_repo_root / "sdks" / "python-client"),
            str(omnigent_repo_root / "sdks" / "ui"),
        ]
        env["PYTHONPATH"] = os.pathsep.join(
            p for p in (env.get("PYTHONPATH", ""), *extra_paths) if p
        )
        # Proxy vars break the local runner tunnel websocket on CI hosts.
        for proxied in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            env.pop(proxied, None)
        env.update(
            {
                "TRACEPARENT": traceparent,
                "OMNIGENT_TELEMETRY_ENABLED": "true",
                "OTEL_EXPORTER_OTLP_ENDPOINT": collector.endpoint,
                "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
                "OTEL_METRICS_EXPORTER": "none",
                "OTEL_LOGS_EXPORTER": "none",
                # Tighten the batch delay so short-lived processes flush.
                "OTEL_BSP_SCHEDULE_DELAY": "200",
                "NO_PROXY": "127.0.0.1,localhost",
                "no_proxy": "127.0.0.1,localhost",
            }
        )

        yaml_path = omnigent_repo_root / "tests" / "resources" / "examples" / "hello_world.yaml"
        result = subprocess.run(
            [
                str(omnigent_python),
                "-m",
                "omnigent",
                "run",
                str(yaml_path),
                "--model",
                _MODEL,
                "--harness",
                _HARNESS,
                "-p",
                _PROMPT,
                "--no-log",
                "--no-session",
            ],
            env=env,
            cwd=str(omnigent_repo_root),
            capture_output=True,
            text=True,
            timeout=_RUN_TIMEOUT_SEC,
        )
        assert result.returncode == 0, (
            f"omnigent run failed (exit {result.returncode}) - the telemetry "
            f"rig never got exercised.\n"
            f"stdout:\n{result.stdout!r}\n\nstderr:\n{result.stderr[-4000:]!r}"
        )

        # Rig sanity: the run must have exported spans at all; otherwise
        # this failure would be about the collector, not the bug.
        deadline = time.monotonic() + _SPAN_DRAIN_SEC
        while time.monotonic() < deadline and not collector.snapshot():
            time.sleep(0.5)
        # Grace period for stragglers from the server/runner shutdown flush.
        time.sleep(2.0)
        spans = collector.snapshot()
        assert spans, (
            "omnigent exported no spans to the OTLP collector; telemetry "
            "was not active, so the TRACEPARENT-extraction behavior could "
            "not be observed. Check OMNIGENT_TELEMETRY_ENABLED wiring."
        )

        # The bug: no omnigent span joins the dispatching client's trace.
        joined = [s for s in spans if s["trace_id"] == caller_trace_id]
        assert joined, (
            f"no omnigent span carried the dispatching client's "
            f"trace id.\n"
            f"caller TRACEPARENT: {traceparent}\n"
            f"caller trace id:    {caller_trace_id}\n"
            f"collected {len(spans)} omnigent spans, ALL on omnigent-"
            f"generated trace ids - the caller's context died at the "
            f"server boundary.\nLargest omnigent traces:\n"
            f"{_summarize_traces(spans)}"
        )
    finally:
        collector.close()
