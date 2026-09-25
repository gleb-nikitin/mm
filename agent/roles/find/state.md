No active task.

Last completed: chain `xjr` token-fill research for Claude `/tokens/by-participant`.
Conclusion: current context fill is a latest-request snapshot, not cumulative billing.
Use latest Claude assistant usage `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
as the ac-parity pressure metric; optionally add only the latest `output_tokens` if measuring
post-response context before the next user turn. Never sum `cache_read_input_tokens` across turns.
