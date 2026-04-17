# Handoff — mm_git

## Current State
- `git` role established and scripts implemented.
- Added Web UI and async refactor for `runGemini` (`ed3eaf2`).
- Added Claude Code sessions import script and macOS run/kill commands (`dd9bba4`).
- **Landed source-separation end-to-end** (`7b5f0ef`): schema v4, recursive indexing, filtered retrieval by source_type/project.
- Project structure refactored: core in `src/`, scripts in `scripts/`.
- Repository is clean.

## Tasks
- [x] Establish `git` role and scripts.
- [x] Implement `commit-scope.sh`, `commit-sweep.sh`, `preflight.sh` scripts in `agent/roles/git/`.
- [x] Commit initial UI and async refactor.
- [x] Commit Claude Code sessions import work and macOS commands.
- [x] Commit source-separation feature.

## Blockers
- None.
