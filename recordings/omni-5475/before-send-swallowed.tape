Output recordings/omni-5475/before-send-swallowed.mp4
Set FontSize 15
Set Width 1400
Set Height 800
Set Theme "Dracula"
Set TypingSpeed 40ms
Type "# OMNI-5475 facet 3: a send during an active native turn is accepted (202 buffered) but never runs"
Enter
Sleep 1s
Type "pytest tests/runner/test_native_subagent_status_laundering.py::test_native_send_during_active_turn_is_rejected_not_swallowed -q --no-header -p no:cacheprovider 2>&1 | grep -v -E '^(INFO|ERROR|WARNING)' | tail -20"
Enter
Sleep 55s
Screenshot recordings/omni-5475/before-send-swallowed.png
