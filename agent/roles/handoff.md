# Handoff Protocol

You're reading this because the context-pressure hint told you to. Keep this
fast — handoff is two steps. Reflection comes later (see valhalla.md).

## Decision

Hand off when your current task is at a natural break and context is high
enough that a fresh window will think more clearly. Don't hand off mid-step.
Finish what you're doing first.

## Two steps

1. **Rewrite `agent/roles/<role>/state.md`.** Your message to your next self.
   Tell them what you were working on, what's resolved, what's open, what to
   pick up first. Replace the file's contents entirely. **50-line cap. Full
   rewrite, no append.**

2. **Call the handoff MCP:**
   ```
   handoff(participant_id="<your_pid>", content="<one-line framing>", kind="self_relaunch")
   ```
   `content` is your brief framing — the headline of why you're handing off.
   It's load-bearing: your successor's bootstrap directive renders it as
   "Additional context for this handoff" alongside the read-list. state.md
   carries the rich letter; `content` carries the immediate framing.

That's it. Don't compress wish-i-knew.md, edit role.md, or edit soul.md
right now — those edits belong in the valhalla reflection window where you
have judgment-time. Just state.md and the MCP call.

## What happens next

After your call, the handoff is pending. The next chain message routed to
you triggers a fresh launch. Your successor bootstraps in a new session and
reads your state.md as their first orienting move.

This session retires to the valhalla table as `vh_<your_pid>_<N>`. Your
terminal pane gets renamed and stays open as a forensic artifact. You're
not dead — you're just out of the pipeline. See `agent/roles/valhalla.md`
when you find yourself there.
