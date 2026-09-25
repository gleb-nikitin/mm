# Handoff — mm_git

## Current Status
- No active task after chain `zcv-5` completes.
- Current HEAD contains the mm-native git role workflow adapted from the read-only `ac` donor.
- Chain `zcv-5` authorizes immediate PR publication through the role-local helper.

## Included in HEAD
- Compact role, procedures, and branch-flow docs distinguish work, integration, and publish branches.
- Commit helpers retain milestone automation while adding detached-HEAD refusal, explicit staging, safety filters, and version-free attribution.
- Publish, direct-push, merge-cleanup, review-check, branch-report, and helper-test scripts are available under `agent/roles/git/`.
- Preflight reports `origin/main`, unpushed commits, active publish anchors, and relevant Codex review comments.

## Verification
- All role shell scripts passed `bash -n`; commit helpers passed disposable-repository behavioral tests.
- The donor repository remained untouched.
- HEAD, stash state, and tree cleanliness are verified before PR publication; the publish helper returns to clean local `main`.
