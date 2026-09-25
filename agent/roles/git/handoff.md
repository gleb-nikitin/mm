# Handoff — mm_git

## Current Status
- HEAD contains the second post-merge release batch and the CTO production-checkout safety note.
- One operator-authorized PR is ready to publish from local `main`; the operator will merge it.
- `agent/roles/find/state.md` is unrelated stale state and remains outside the release.

## Release Range
- Atomic one-time notes FTS migration.
- Codex mixed-turn normalization and session identity fixes.
- Append-retaining chunks with hashed note provenance.
- Notes integrated into hybrid retrieval.
- CTO operational lessons about production checkout safety.

## Publish State
- Publish only through `push-pr.sh --operator-authorized`.
- Park only `agent/roles/find/state.md` during publication and restore it byte-identically afterward.
- Do not merge the PR; `u_gleb` owns the merge step.
