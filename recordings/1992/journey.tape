# OMNI-1992 — expired Databricks credential: 'omnigent run --server <url> -p hi'
# dies at session-create with the edge's raw 403 'Invalid access token'
# instead of routing the user to reauth.
# Terminal-evidence fallback: runs the reproduction e2e test, which stages the
# expired credential + a live stub Databricks edge and drives the REAL
# 'omnigent run' journey headlessly; the run ends on the assertion showing the
# raw 403 the user sees.
Output recordings/1992/before-expired-credential-launch.mp4
Set Shell bash
Set FontSize 14
Set Width 1500
Set Height 800
Set Padding 12
Type "# OMNI-1992: user logged in once to a Databricks-fronted server; the OAuth token expired."
Enter
Type "# The launch must offer reauth - instead it dies with the edge's raw 403. Run the repro test:"
Enter
Sleep 1.5s
Type "/home/runner/work/omnigent-internal/omnigent-internal/omnigent-src/.venv/bin/python -m pytest tests/e2e/test_expired_databricks_credential_1992.py -v 2>&1 | tail -30"
Enter
Wait+Screen@120s /Invalid access token/
Sleep 5s
