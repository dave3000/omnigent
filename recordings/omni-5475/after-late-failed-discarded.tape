Output recordings/omni-5475/after-late-failed-discarded.mp4
Set FontSize 15
Set Width 1400
Set Height 800
Set Theme "Dracula"
Set TypingSpeed 40ms
Type "# After fix: a late 'failed' report now replaces a delivered quiescence 'completed' and is re-delivered to the parent"
Enter
Sleep 1s
Type "pytest tests/runner/test_native_subagent_status_laundering.py::test_late_failed_report_must_not_be_discarded_by_delivered_completed -q --no-header -p no:cacheprovider 2>&1 | grep -v -E '^(INFO|ERROR|WARNING)' | tail -20"
Enter
Sleep 25s
Screenshot recordings/omni-5475/after-late-failed-discarded.png
