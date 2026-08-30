Output recordings/omni-5475/after-send-swallowed.mp4
Set FontSize 15
Set Width 1400
Set Height 800
Set Theme "Dracula"
Set TypingSpeed 40ms
Type "# After fix: a dispatch wedged in 'launching' is failed loudly to the parent by the launch-liveness reaper, never silently lost"
Enter
Sleep 1s
Type "pytest tests/runner/test_native_subagent_status_laundering.py::test_wedged_launching_dispatch_fails_loudly_to_parent tests/runner/test_native_subagent_status_laundering.py::test_started_dispatch_is_not_reaped_by_launch_liveness -q --no-header -p no:cacheprovider 2>&1 | grep -v -E '^(INFO|ERROR|WARNING)' | tail -20"
Enter
Sleep 30s
Screenshot recordings/omni-5475/after-send-swallowed.png
