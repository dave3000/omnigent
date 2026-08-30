# Expired Databricks credential launch — AFTER the fix: 'omnigent run
# --server <url> -p hi' with a stale bearer now routes the user to reauth
# (`omnigent login <url>`) instead of dying at session-create with the edge's
# raw 403 'Invalid access token'. Runs the reproduction e2e test, which stages
# the expired credential + a live stub Databricks edge and drives the REAL
# 'omnigent run' journey headlessly; the test now PASSES.
Output recordings/1992/after-expired-credential-launch.mp4
Set Shell bash
Set FontSize 14
Set Width 1500
Set Height 800
Set Padding 12
Type "# Expired Databricks credential: user logged in once, the OAuth token has since expired."
Enter
Type "# FIXED: the launch now stops at the pre-flight with the reauth command instead of the raw 403. Run the repro test:"
Enter
Sleep 1.5s
Type "/home/runner/work/omnigent-internal/omnigent-internal/omnigent-src/.venv/bin/python -m pytest tests/e2e/test_expired_databricks_credential_launch.py -v 2>&1 | tail -12"
Enter
Wait+Screen@120s /1 passed/
Sleep 5s
