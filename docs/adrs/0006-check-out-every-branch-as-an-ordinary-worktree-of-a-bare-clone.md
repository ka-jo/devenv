---
adr: 0006
title: Check out every branch as an ordinary worktree of a bare clone
status: Proposed
date: 2026-07-10
see_also:
  - ADR-0001
  - ADR-0007
---

# ADR 0006: Check out every branch as an ordinary worktree of a bare clone

## Decision

1. devenv MUST hold each repository it works on itself, as a bare clone in a location devenv owns, rather than working on checkouts wherever they happen to be.
2. Every branch, the default branch included, MUST be checked out as an ordinary worktree of that bare clone. No checkout is a primary or base checkout.
3. Each worktree MUST be addable and removable on its own, without affecting the repository's other worktrees.

## Context

Agents run in a sandbox that devenv sets up around the files they work on ([ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)), so devenv has to know where those files are and how they're laid out.

Agents work on branches, and several may work on different branches of the same repository at the same time. Each branch being worked on needs its own copy of the files.

Git can check out several branches of one repository as worktrees that share its objects and refs, so a commit made in one is immediately visible from the others. But a normal clone's own checkout is special: it holds the repository itself, so it can't be removed while other worktrees depend on it, and it stays checked out on whatever branch it was left on.

## Rationale

devenv works best as the one place a repository's branches live. Holding each repository itself, devenv always knows where every checkout is and can lay them out the same way for every repository.

A bare clone keeps the repository out of any checkout, so every branch's checkout is equal: any one, the default branch's included, can be added or removed without touching the rest, and there's no main checkout for a commit to land in by mistake. Worktrees of one clone share a single object store and set of refs, so adding a branch is cheap and work committed on one branch is visible from every other worktree without pushing or fetching.

## Alternatives

### Checkouts wherever they are

Keep working on project checkouts wherever they live on disk, adding devenv's config to each (the setup until this decision).

**Rejected because** devenv can't lay out or manage checkouts it doesn't own, and each project ends up arranged differently.

### A primary checkout with worktrees beside it

A normal clone of the default branch, with other branches added as worktrees next to it.

**Rejected because** the primary checkout isn't like the others: it can't be removed on its own, and commits made there out of habit land on whatever branch it has checked out.

### A clone per branch

A separate full clone for each branch.

**Rejected because** each clone duplicates the repository's objects and keeps its own refs, so work committed in one clone isn't visible to the others until it's pushed and fetched.

## Consequences

- Every repository devenv works on is cloned through devenv and lives in devenv's directory. Checkouts elsewhere aren't used.
- A branch can be checked out in only one worktree at a time.
- A repository's worktrees all share one bare clone, so anything a sandbox can write in it is shared with every other worktree of that repository.

## Confirmation

- `lib/clone.sh` (`cmd_clone`): clones into `worktrees/<repo>/.git` as a bare repository and checks out the default branch as an ordinary worktree beside it.
- `lib/worktree.sh` (`cmd_worktree`): adds, lists and removes branches as worktrees of the bare clone, the default branch included.
- `.gitignore` (`/worktrees/*`): keeps every repository and worktree out of devenv's own history; only `worktrees/.gitkeep` is tracked.
- Not covered: nothing stops a non-bare checkout from being created under `worktrees/` by hand.
