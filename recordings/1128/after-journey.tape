Output recordings/1128/after-subagent-model.mp4
Set FontSize 15
Set Width 1400
Set Height 800
Set Shell bash
Set TypingSpeed 25ms

Type "source resolve-live/rec_env.sh"
Enter
Sleep 500ms

Type "# after the fix: launch polly with an explicitly selected model (claude-sonnet-4-6)"
Enter
Type "python -m omnigent run $OMNI705_SPEC --server $OMNI705_SERVER --model claude-sonnet-4-6 -p 'Dispatch one read-only explore task to claude_code.'"
Enter
Wait+Screen@180s /Turn complete|Dispatched claude_code|omnigent:.*(done|complete)|\$ $/
Sleep 2s

Type "# what model did the dispatched sub-agent actually get?"
Enter
Type "python resolve-live/probe_child_model.py"
Enter
Wait+Screen@60s /BUG: sub-agent did NOT inherit|sub-agent inherited/
Sleep 4s
