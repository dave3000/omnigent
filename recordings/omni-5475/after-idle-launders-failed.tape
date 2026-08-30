Output recordings/omni-5475/after-idle-launders-failed.mp4
Set FontSize 15
Set Width 1400
Set Height 800
Set Theme "Dracula"
Set TypingSpeed 40ms
Type "# After fix: trailing watcher 'idle' no longer launders a failed native sub-agent turn — the child stays 'failed'"
Enter
Sleep 1s
Type "pytest tests/runner/test_native_subagent_status_laundering.py::test_trailing_idle_must_not_launder_failed_child_status -q --no-header -p no:cacheprovider 2>&1 | grep -v -E '^(INFO|ERROR|WARNING)' | tail -25"
Enter
Sleep 25s
Screenshot recordings/omni-5475/after-idle-launders-failed.png
