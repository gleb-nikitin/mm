# Branch Flow

Use `work/*` for uncertainty, `main` for integration, and `publish/*` for PR transport.

## Default
- Small, scoped changes may land on local `main`.
- Risky refactors, experiments, and unclear changes start on `work/<topic>`.
- Never do normal work on `publish/*`; `push-pr.sh` creates that branch.
- Abandon an unpublished work branch when the direction is bad; revert integrated work only when authorized.

## Exploration
```bash
git switch main
git pull --ff-only
git switch -c work/some-topic
```

Before integration, run `agent/roles/git/work-branches.sh`. If the work is sound and fast-forwardable:

```bash
git switch main
git merge --ff-only work/some-topic
agent/roles/git/push-pr.sh --operator-authorized --topic some-topic
```

## Publish Cycle
- `push-pr.sh` requires clean local `main` ahead of `origin/main`.
- It creates `publish/<topic-or-sha>`, pushes it, opens a PR, records `.git/git-publish-anchor`, and returns to `main`.
- A failure after branch creation returns to `main`, keeps the publish branch, and reports its name; existing-branch guards remain fail-safe rather than resuming automatically.
- The anchor records the PR number and published SHA so cleanup cannot silently discard later local commits.
- After the operator merges the PR, `merge-done.sh` verifies the merge, synchronizes `main`, deletes the publish branch, and removes the anchor.
- If local `main` moves after publication, cleanup refuses until the mismatch is resolved explicitly.

## Parallel Work
- `work-branches.sh` reports changed files, base divergence, fast-forward readiness, and pairwise overlap.
- Overlap means integration needs coordination; no overlap is not proof of semantic independence.
- Open-PR fixes should normally become a focused follow-up unless the operator explicitly chooses branch surgery.
