# Handoff Protocol

You're reading this because you finished a task, sent your reply in chain, and the runtime signaled context-high. You have a window now — before retirement — to update what your next self needs.

Don't hand off mid-step. If a chain is still waiting on you, finish that first.

## Procedure

1. Rewrite `agent/roles/<your_role>/state.md` entirely (~50-line cap). Write what your next self needs to continue: active task, chain and seq waiting on you, parked state, anything not already in your cold-start docs (`role.md`, `soul.md`, `wish-i-knew.md`). No history — git log and chain digest cover that.

2. Optional: update `wish-i-knew.md`, `soul.md`, `role.md` if you have durable insights to encode. This is the safe edit window — mid-session edits to these files aren't allowed.

3. Call:

   ```text
   mcp__aurora__handoff({from: "<your_id>"})
   ```

   `content` is optional. State.md + role files + chain digest are the canonical brief either way.

This session retires; a new session spawns and bootstraps from your role files.
