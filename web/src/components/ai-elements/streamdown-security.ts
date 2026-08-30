import { cjk } from "@streamdown/cjk";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { defaultRehypePlugins, type LinkSafetyConfig, type StreamdownProps } from "streamdown";
import { lazyCodePlugin } from "./lazyCodePlugin";

type StreamdownRehypePlugins = NonNullable<StreamdownProps["rehypePlugins"]>;
type StreamdownRehypePlugin = StreamdownRehypePlugins[number];
type StreamdownPluginTuple = Extract<StreamdownRehypePlugin, readonly unknown[]>;
type StreamdownHardenOptions = {
  allowedImagePrefixes: string[];
  allowedLinkPrefixes?: string[];
  allowedProtocols?: string[];
  allowDataImages?: boolean;
  defaultOrigin?: string;
};
type StreamdownHardenPlugin = StreamdownPluginTuple & {
  1: StreamdownHardenOptions;
};

export const STREAMDOWN_PLUGINS = {
  cjk,
  code: lazyCodePlugin,
  // Only `$$…$$` opens math. A single `$` is prose far more often than it is a
  // math delimiter — currency ($5), rates ($/PR, $/session), shell variables
  // ($LLM_API_KEY) — and single-dollar math pairs any two of them up, rendering
  // the whole span between them as letter-by-letter math soup. Explicit TeX
  // delimiters (`\(…\)`, `\[…\]`), which is what LLMs emit for real math, are
  // rewritten to `$$…$$` by `normalizeExplicitMathDelimiters`.
  math: createMathPlugin({ singleDollarTextMath: false }),
  mermaid,
};
export const SECURE_STREAMDOWN_REHYPE_PLUGINS = createStreamdownRehypePlugins(false);
export const FILE_LINK_STREAMDOWN_REHYPE_PLUGINS = createStreamdownRehypePlugins(true);

// Attribute carrying the original, unhardened href of a workspace-file link.
export const WORKSPACE_FILE_LINK_ATTR = "data-omnigent-file";

// An href that can only be a protocol URL, a protocol-relative URL, or an
// in-page anchor, never a path to a file in the session workspace. The
// lookahead keeps a cited position off the scheme branch: `notes.md:12` is a
// filename plus a line number, but is otherwise shaped exactly like a scheme.
const NON_FILE_HREF = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d+(?::\d+)?$)|\/\/|#)/;

// Where a file link's href is parked once the path moves to the data
// attribute. Must be a *named* fragment: harden passes a fragment-only href
// through only when `new URL(href, base).hash` round-trips, and a bare "#"
// parses to an empty hash, so it would be blocked like any unresolvable URL.
const PARKED_FILE_HREF = "#omnigent-file";

interface HastElement {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastElement[];
}

// Streamdown enables a link-safety confirmation modal by default: clicking any
// markdown link pops an "Open external link?" dialog instead of following the
// link. Disable it so the renderer can use native anchors without an extra
// confirmation click. ChatMarkdown owns the final target: non-Electron links
// use `_self` (native shells may still intercept off-origin activation), while
// Electron keeps `_blank` so its main-process popup and external-protocol
// policy remains on the navigation path.
export const CHAT_LINK_SAFETY: LinkSafetyConfig = { enabled: false };

/**
 * Rewrites every `file://` link naming a local absolute path to that plain
 * path, so it survives sanitize and reaches {@link markWorkspaceFileLinks}.
 *
 * Agents routinely link a file they just wrote as a `file://` URI
 * (`[report.md](file:///abs/ws/report.md)`). Such a URI names the *runner
 * host's* disk, which the browser can never reach — and sanitize strips the
 * `file:` href (not in its protocol allowlist) before the marking pass runs,
 * so the link rendered as an inert " [blocked]" span: the user could not open
 * the created file at all. Rewritten to the plain filesystem path, the link
 * flows through the same workspace-file handover as an absolute-path link and
 * opens in the FileViewer, which fetches over the session connection.
 *
 * Must run *before* Streamdown's sanitize step. Only URIs that can name a
 * local file are rewritten: a host (UNC share), a query/fragment, or a
 * multi-slash path (which would read as a protocol-relative URL) all stay
 * `file:` hrefs for sanitize/harden to strip and block exactly as before.
 */
export function rewriteFileUriLinks() {
  return (tree: HastElement) => {
    visitElements(tree, (node) => {
      if (node.tagName !== "a") return;
      const href = node.properties?.href;
      if (typeof href !== "string" || !/^file:/i.test(href)) return;
      const path = fileUriToLocalPath(href);
      if (!path) return;
      node.properties = { ...node.properties, href: path };
    });
  };
}

/**
 * The local absolute filesystem path a `file://` URI names, or null when the
 * URI cannot safely be treated as one (a UNC host, a query/fragment, an
 * undecodable escape, a decoded form that would change meaning as an href,
 * or a parse failure).
 */
function fileUriToLocalPath(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  // A host names another machine's share, and a query/fragment is not part
  // of a filename — neither can be a workspace file.
  if (url.protocol !== "file:" || url.hostname || url.search || url.hash) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  // The decoded path becomes an href: `//…` would read as a protocol-relative
  // URL, and a literal `?`/`#` would split it. A bare `/` names no file.
  if (!path.startsWith("/") || path.startsWith("//") || path === "/" || /[?#]/.test(path)) {
    return null;
  }
  return path;
}

/**
 * Moves the href of every file-path link onto {@link WORKSPACE_FILE_LINK_ATTR}
 * and parks the href on an inert fragment.
 *
 * Agents routinely link a file they just wrote (`[foo.md](/abs/ws/foo.md)`).
 * Left alone, Streamdown's harden pass either keeps such a link as a real
 * anchor (so clicking it navigates the app origin and 404s), or, for a path
 * with no leading slash, strips the href and appends " [blocked]", which
 * reads as though the app censored the link. Both are wrong: the link
 * names a workspace file and should open the FileViewer.
 *
 * Running before harden hands the path to a renderer that owns the click
 * instead. A fragment href is chosen because harden passes those through
 * untouched, while an anchor with *no* href is blocked like any other
 * unresolvable URL. Only hrefs that could name a real file are moved: a URL,
 * a `mailto:`/`javascript:` scheme, or anything carrying a query or fragment
 * is left for harden to judge exactly as before.
 */
export function markWorkspaceFileLinks() {
  return (tree: HastElement) => {
    visitElements(tree, (node) => {
      if (node.tagName !== "a") return;
      const href = node.properties?.href;
      if (typeof href !== "string" || !href) return;
      if (NON_FILE_HREF.test(href) || href.includes("?") || href.includes("#")) return;
      node.properties = {
        ...node.properties,
        href: PARKED_FILE_HREF,
        [WORKSPACE_FILE_LINK_ATTR]: href,
      };
    });
  };
}

function visitElements(node: HastElement, visitor: (node: HastElement) => void): void {
  if (node.type === "element") visitor(node);
  for (const child of node.children ?? []) {
    visitElements(child, visitor);
  }
}

function isStreamdownHardenPlugin(
  plugin: StreamdownRehypePlugin,
): plugin is StreamdownHardenPlugin {
  return Array.isArray(plugin) && plugin.length >= 2 && isHardenOptions(plugin[1]);
}

function isHardenOptions(value: unknown): value is StreamdownHardenOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    "allowedImagePrefixes" in value &&
    Array.isArray(value.allowedImagePrefixes)
  );
}

function createStreamdownRehypePlugins(markFileLinks: boolean): StreamdownRehypePlugins {
  const plugins: StreamdownRehypePlugins = [];
  let sawSanitize = false;

  for (const [key, plugin] of Object.entries(defaultRehypePlugins)) {
    // Before sanitize, which would strip a `file:` href (not in its protocol
    // allowlist) with nothing left to hand to the marking pass below.
    if (key === "sanitize") {
      sawSanitize = true;
      if (markFileLinks) plugins.push(rewriteFileUriLinks);
    }

    if (key !== "harden") {
      plugins.push(plugin);
      continue;
    }

    // Immediately before harden, and so after Streamdown's `sanitize` step,
    // which drops the marker attribute as unknown. Sanitize has also already
    // stripped any dangerous href, leaving nothing to hand over for such a link.
    if (markFileLinks) {
      plugins.push(markWorkspaceFileLinks);
    }

    if (!isStreamdownHardenPlugin(plugin)) {
      throw new Error("Streamdown harden plugin must be a [plugin, options] tuple");
    }

    plugins.push([
      plugin[0],
      { ...plugin[1], allowedImagePrefixes: [] },
    ] satisfies StreamdownPluginTuple);
  }

  // Fail loud (like the harden tuple check above) rather than silently ship a
  // pipeline where `file://` links regress to " [blocked]" spans.
  if (markFileLinks && !sawSanitize) {
    throw new Error("Streamdown default rehype plugins carry no sanitize step");
  }

  return plugins;
}
