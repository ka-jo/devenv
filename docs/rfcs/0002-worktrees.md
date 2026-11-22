---
rfc: 0002
title: Worktrees
status: Draft
see_also:
  - ADR-0006
  - ADR-0007
  - ADR-0008
  - RFC-0007
---

# RFC 0002: Worktrees

## 1. Summary

This RFC specifies how devenv holds the repositories agents work on: where each repository and its worktrees live, the commands that clone a repository, add and remove worktrees, and list them, and how every command that acts on one worktree resolves it. Each worktree is where one branch is checked out, and the unit that gets a sandbox of its own (RFC-0007).

## 2. Motivation

Every repository devenv works on is a bare clone that devenv holds itself, with every branch, the default branch included, checked out as an ordinary worktree beside it ([ADR-0006](../adrs/0006-check-out-every-branch-as-an-ordinary-worktree-of-a-bare-clone.md)). Each worktree gets one sandbox, shared by every agent working in it ([ADR-0007](../adrs/0007-give-each-worktree-one-sandbox-shared-by-every-agent-working-in-it.md)), and every sandbox mounts the repository at the same paths as the host ([ADR-0008](../adrs/0008-mirror-the-hosts-paths-in-every-sandbox.md)). This RFC specifies the layout those decisions rest on and the commands that manage it.

Prior to this RFC, these commands differed from what is specified here:

- `devenv worktree rm` removed the worktree and its sandbox's data before deleting the branch, so a branch that wasn't fully merged left the command failed halfway, with the worktree already gone and the branch still there (§4.5).
- `devenv worktree rm` left the worktree's sandbox behind: its containers and its generated state (§4.5.1, §4.5.3, §4.5.4).
- `devenv worktree rm` deleted the repository's default branch along with its worktree, after which adding a new branch without a base failed (§4.5.5).
- `devenv worktree list` printed `git worktree list`'s own output, bare repositories included (§4.6).
- `devenv clone` and `devenv worktree` printed errors on stdout (RFC-0001 §4.2).
- A `devenv clone` that failed left an empty folder behind, so trying again reported that the repository already existed (§4.2.5).
- Nothing stopped `devenv clone` or `devenv worktree add` from creating a worktree whose sandbox name another worktree already had (§4.1.2).
- `devenv worktree rm` given a `<repo> <branch>` with no worktree reported git's own error instead of devenv's (§4.4.2).

## 3. Interface

### 3.1. Repository layout

```text
~/devenv/worktrees/
  <repo>/
    .git/                  the bare clone
    <branch>/              a worktree: one branch checked out
    <prefix>/<rest>/       a worktree for a branch named <prefix>/<rest>
```

- `<repo>`: the repository's name in devenv, chosen when it's cloned (§3.2).
- `<branch>`: the name of the branch checked out there. A branch name containing `/` becomes nested folders.

### 3.2. `devenv clone`

```text
devenv clone <url> [<name>]
```

- `<url>`: the URL of a git remote.
- `<name>`: the repository's name in devenv (§3.1).

Outputs: stdout `cloned <name> -> <path>`, where `<path>` is the default branch's worktree; diagnostics (RFC-0001).

### 3.3. `devenv worktree add`

```text
devenv worktree add <repo> <branch> [<base>]
```

- `<repo>`: a repository's name (§3.1).
- `<branch>`: the branch to check out.
- `<base>`: a commit, branch or tag to start a new branch from.

Outputs: stdout `worktree ready: <path>`; diagnostics (RFC-0001).

### 3.4. `devenv worktree rm`

```text
devenv worktree rm [<repo> <branch>] [--force]
```

- `<repo> <branch>`: the worktree to remove. Given together or not at all.
- `--force`: a switch.

Outputs: stdout `removed sandbox: <repo>/<branch>` when there was one, `removed: <path>`, and `deleted branch: <branch>` when the branch was deleted; diagnostics (RFC-0001).

### 3.5. `devenv worktree list`

```text
devenv worktree list [<repo>]
```

- `<repo>`: a repository's name (§3.1).

Outputs: stdout one line per worktree, `<repo>\t<branch>\t<path>`; diagnostics (RFC-0001).

## 4. Behavior

### 4.1. Invariants

These requirements apply to every command in §4.2 through §4.6. A command is _creating a worktree_ while `devenv clone` checks out the default branch (§4.2.3) and while `devenv worktree add` checks out `<branch>` (§4.3).

#### 4.1.1. Relative links

A command SHALL create every worktree with relative links between the worktree and its bare clone (`--relative-paths`), so they resolve the same way inside a sandbox ([ADR-0008](../adrs/0008-mirror-the-hosts-paths-in-every-sandbox.md)).

#### 4.1.2. Sandbox name collisions

WHILE a command is creating a worktree and another worktree, of any repository, already has the sandbox name (RFC-0007 §3.1) the new one would have, the command SHALL fail (RFC-0001 §4.3) AND SHALL leave behind nothing it created. Its error message MUST name the existing worktree, as `<repo>/<branch>`. It MUST name the sandbox name the two would share.

> [!NOTE]
> Two worktrees with the same sandbox name would share one sandbox, breaking [ADR-0007](../adrs/0007-give-each-worktree-one-sandbox-shared-by-every-agent-working-in-it.md). The sandbox name drops characters such as `/` and `.`, so `feature/x` and `feature-x` collide, and so can a new repository's name with an existing repository's branch (`app-feature` + `x` and `app` + `feature-x`). `devenv clone` creates the default branch's worktree, so the check covers it too.

### 4.2. Cloning a repository

#### 4.2.1. Name

WHEN `<name>` is omitted, `devenv clone` SHALL use the last segment of `<url>`'s path, without a trailing `.git`, as the repository's name.

#### 4.2.2. Bare clone

`devenv clone` SHALL clone the repository as a bare repository at `worktrees/<name>/.git`, AND SHALL configure it to fetch every branch of `origin` into `refs/remotes/origin/*`, AND SHALL fetch them, so the remote's branches are known and tracked.

> [!NOTE]
> A bare clone leaves `remote.origin.fetch` unset, so without this, fetching would only ever update `FETCH_HEAD`.

#### 4.2.3. Default branch

`devenv clone` SHALL check out the remote's default branch as an ordinary worktree at `worktrees/<name>/<default-branch>` after fetching.

#### 4.2.4. Existing target

WHILE `worktrees/<name>` exists, `devenv clone` SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST name the existing path.

#### 4.2.5. Failed clone

IF cloning fails, THEN `devenv clone` SHALL fail (RFC-0001 §4.3) AND SHALL leave no `worktrees/<name>` behind.

IF fetching fails, THEN `devenv clone` SHALL fail (RFC-0001 §4.3) AND SHALL leave no `worktrees/<name>` behind.

#### 4.2.6. Success

`devenv clone` SHALL print `cloned <name> -> <path>` on stdout as its last step, where `<path>` is the default branch's worktree.

### 4.3. Adding a worktree

#### 4.3.1. Unknown repository

IF `<repo>` names a repository with no bare clone in `worktrees/`, THEN `devenv worktree add` SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST name `devenv clone <url> <repo>` as the way to add the repository.

#### 4.3.2. Existing branch

WHILE `<branch>` exists as a local branch, `devenv worktree add` SHALL check the branch out at `worktrees/<repo>/<branch>` AND SHALL ignore `<base>`.

WHILE `<branch>` exists only on the remote, as `origin/<branch>`, `devenv worktree add` SHALL create a local branch that tracks `origin/<branch>`, AND SHALL check it out at `worktrees/<repo>/<branch>`, AND SHALL ignore `<base>`.

#### 4.3.3. New branch

WHILE `<branch>` exists neither locally nor on the remote, WHEN `<base>` is given, `devenv worktree add` SHALL create the branch from `<base>` AND SHALL check it out at `worktrees/<repo>/<branch>`.

WHILE `<branch>` exists neither locally nor on the remote, WHEN `<base>` is omitted, `devenv worktree add` SHALL create the branch from the repository's default branch AND SHALL check it out at `worktrees/<repo>/<branch>`.

#### 4.3.4. Branch already checked out

WHILE `<branch>` is checked out in another worktree, `devenv worktree add` SHALL fail (RFC-0001 §4.3) without creating anything. Its error message MUST name the worktree that has the branch checked out.

#### 4.3.5. Success

`devenv worktree add` SHALL print `worktree ready: <path>` on stdout as its last step.

### 4.4. Resolving a worktree

Every devenv command that acts on one worktree takes it as `<repo> <branch>`, given together or not at all, and resolves it the same way. devenv is _resolving a worktree_ while any such devenv command does this. Its picker offers _the eligible worktrees_: every worktree of every repository, unless that devenv command's own section limits them. 

#### 4.4.1. A given worktree

WHILE devenv is resolving a worktree, WHEN `<repo>` and `<branch>` are given, devenv SHALL use the worktree at `worktrees/<repo>/<branch>`.

#### 4.4.2. Unknown worktree

WHILE devenv is resolving a worktree, IF `<repo>` and `<branch>` name no worktree at `worktrees/<repo>/<branch>`, THEN devenv SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST name the worktree as `<repo>/<branch>`. It MUST name `devenv worktree add <repo> <branch>` as the way to create it.

#### 4.4.3. The picker

WHILE devenv is resolving a worktree, WHEN `<repo>` and `<branch>` are omitted, devenv SHALL show an interactive `fzf` list of the eligible worktrees, reading the choice as RFC-0001 §4.11 specifies, AND SHALL use the worktree picked.

> [!NOTE]
> A devenv command's own section may limit the eligible worktrees, for example to those whose sandbox is running. Without such a limit, every worktree of every repository is eligible.

#### 4.4.4. Nothing to pick

WHILE devenv is resolving a worktree, WHEN `<repo>` and `<branch>` are omitted, IF there are no eligible worktrees, THEN devenv SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST say that there is no worktree to pick.

#### 4.4.5. No `fzf`

WHILE devenv is resolving a worktree and `fzf` isn't installed, WHEN `<repo>` and `<branch>` are omitted, devenv SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST say to pass `<repo> <branch>` or install `fzf`.

#### 4.4.6. Cancelled picker

WHILE devenv is resolving a worktree, IF the picker is cancelled, THEN devenv SHALL exit with the status for a cancelled command (RFC-0001 §3.3) AND SHALL change nothing.

### 4.5. Removing a worktree

`devenv worktree rm` removes a worktree together with everything devenv keeps for it, and checks everything that could stop it (§4.5.1, §4.5.2) before removing anything. It is _removing_ the worktree while none of those checks stops it, and whenever `--force` is given.

#### 4.5.1. Running sandbox

WHILE the worktree's sandbox is running, WHEN `--force` is omitted, `devenv worktree rm` SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST name `devenv container down <repo> <branch>` as the way to stop the sandbox. It MUST name `--force` as the way to stop it and remove the worktree anyway.

#### 4.5.2. Uncommitted or unmerged work

WHILE the worktree has uncommitted changes or untracked files, as `git worktree remove` judges them, WHEN `--force` is omitted, `devenv worktree rm` SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST say that the worktree has uncommitted changes or untracked files. It MUST name `--force` as the way to remove the worktree anyway.

WHILE the worktree's branch isn't fully merged, as `git branch -d` judges it, WHEN `--force` is omitted, `devenv worktree rm` SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST say that the branch isn't fully merged. It MUST name `--force` as the way to remove the worktree anyway.

#### 4.5.3. Removing the sandbox

WHILE `devenv worktree rm` is removing the worktree and the worktree has a sandbox, `devenv worktree rm` SHALL remove the sandbox's containers and networks, as `devenv container down` does (RFC-0007 §4.4.1), before removing anything else, AND SHALL print `removed sandbox: <repo>/<branch>` on stdout.

#### 4.5.4. Removing the worktree

WHILE `devenv worktree rm` is removing the worktree, `devenv worktree rm` SHALL remove its sandbox's generated state and Claude Code data (RFC-0007 §3.2), AND SHALL remove the worktree, AND SHALL remove any folders the removal left empty under `worktrees/<repo>/`, AND SHALL print `removed: <path>` on stdout.

#### 4.5.5. The branch

WHILE `devenv worktree rm` is removing the worktree and its branch isn't the repository's default branch, `devenv worktree rm` SHALL delete the branch AND SHALL print `deleted branch: <branch>` on stdout.

WHILE `devenv worktree rm` is removing the worktree and its branch is the repository's default branch, `devenv worktree rm` SHALL NOT delete the branch.

> [!NOTE]
> The bare clone's `HEAD` names the default branch. Deleting it would leave `HEAD` naming a branch that doesn't exist, and §4.3.3 creates new branches from it.

#### 4.5.6. Force

WHEN `--force` is given, `devenv worktree rm` SHALL remove the worktree as §4.5.3 through §4.5.5 specify, even while its sandbox is running, it has uncommitted changes or untracked files, or its branch isn't fully merged.

> [!NOTE]
> So `--force` stops a running sandbox, discards uncommitted changes and untracked files, and deletes a branch that isn't fully merged. It never deletes the default branch.

#### 4.5.7. Resolving the worktree

`devenv worktree rm` SHALL resolve the worktree to remove as §4.4 specifies.

### 4.6. Listing worktrees

#### 4.6.1. Every worktree

WHEN `<repo>` is omitted, `devenv worktree list` SHALL print one line per worktree of every repository, `<repo>\t<branch>\t<path>`, AND SHALL print no line for the bare clones themselves.

#### 4.6.2. One repository

WHEN `<repo>` is given, `devenv worktree list` SHALL print only that repository's lines.

#### 4.6.3. Unknown repository

IF `<repo>` names a repository with no bare clone in `worktrees/`, THEN `devenv worktree list` SHALL fail (RFC-0001 §4.3). Its error message MUST name the repository.

#### 4.6.4. Order

`devenv worktree list` SHALL print its lines sorted by repository and then by branch.

## 5. Examples

### 5.1. Removing a worktree whose sandbox is running

Setup: `worktrees/app/feature/login` has a running sandbox.

Call: `devenv worktree rm app feature/login`

Result: exit status `1`, nothing removed, and on stderr:

```text
error: app/feature/login's sandbox is running; stop it with: devenv container down app feature/login (or pass --force)
```

Call: `devenv container down app feature/login`, then `devenv worktree rm app feature/login`

Result: the sandbox's state and Claude Code data, the worktree and the `feature/login` branch are removed, and the now-empty `worktrees/app/feature/` folder with them. On stdout:

```text
removed: /home/dev/devenv/worktrees/app/feature/login
deleted branch: feature/login
```

### 5.2. Listing

Setup: `app` has worktrees for `main` and `feature/login`; `lib` has one for `main`.

Call: `devenv worktree list`

Result:

```text
app	feature/login	/home/dev/devenv/worktrees/app/feature/login
app	main	/home/dev/devenv/worktrees/app/main
lib	main	/home/dev/devenv/worktrees/lib/main
```

## 6. Out of scope

- Sandboxes themselves: creating, starting and stopping them, and how a worktree's sandbox is named. Specified in RFC-0007.
- Fetching, pulling, pushing and merging. devenv doesn't wrap them; they're plain git, run in a worktree or the bare clone.
- Renaming a repository or a branch, and moving a worktree.
- Repositories that devenv didn't clone, and checkouts outside `worktrees/` ([ADR-0006](../adrs/0006-check-out-every-branch-as-an-ordinary-worktree-of-a-bare-clone.md)).
- Removing a whole repository [future]. Today that's removing each worktree, then `worktrees/<repo>` by hand; a command for it would build on §4.5 for each worktree.
