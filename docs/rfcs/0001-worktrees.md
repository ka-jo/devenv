---
rfc: 0001
title: Worktrees
status: Draft
see_also:
  - ADR-0006
  - ADR-0007
  - ADR-0008
  - RFC-0002
---

# RFC 0001: Worktrees

## 1. Summary

This RFC specifies how devenv holds the repositories agents work on: where each repository and its worktrees live, and the commands that clone a repository, add and remove worktrees, and list them. Each worktree is where one branch is checked out, and the unit that gets a sandbox of its own (RFC-0002).

## 2. Motivation

Every repository devenv works on is a bare clone that devenv holds itself, with every branch, the default branch included, checked out as an ordinary worktree beside it ([ADR-0006](../adrs/0006-check-out-every-branch-as-an-ordinary-worktree-of-a-bare-clone.md)). Each worktree gets one sandbox, shared by every agent working in it ([ADR-0007](../adrs/0007-give-each-worktree-one-sandbox-shared-by-every-agent-working-in-it.md)), and every sandbox mounts the repository at the same paths as the host ([ADR-0008](../adrs/0008-mirror-the-hosts-paths-in-every-sandbox.md)). This RFC specifies the layout those decisions rest on and the commands that manage it.

Prior to this RFC, these commands differed from what is specified here:

- `devenv worktree rm` removed the worktree and its sandbox's data before deleting the branch, so a branch that wasn't fully merged left the command failed halfway, with the worktree already gone and the branch still there (§4.4.3).
- `devenv worktree rm` left the worktree's sandbox behind: its containers and its generated state (§4.4.4).
- `devenv worktree rm` deleted the repository's default branch along with its worktree, after which adding a new branch without a base failed (§4.4.5).
- `devenv worktree list` printed `git worktree list`'s own output, bare repositories included (§4.5).
- `devenv clone` and `devenv worktree` printed errors on stdout (§4.1.1).
- A `devenv clone` that failed left an empty folder behind, so trying again reported that the repository already existed (§4.2.4).

## 3. Interface

### 3.1. Diagnostics

Every command in this RFC reports failure the same way:

```text
error: <message>
```

on stderr, with exit status `1`. A command run without the arguments it needs prints its usage line, starting `usage:`, on stderr, with exit status `1`. Output from git that a command passes through may also appear on stderr. Every other outcome exits `0`.

### 3.2. Repository layout

```text
~/devenv/worktrees/
  <repo>/
    .git/                  the bare clone
    <branch>/              a worktree: one branch checked out
    <prefix>/<rest>/       a worktree for a branch named <prefix>/<rest>
```

- `<repo>`: the repository's name in devenv, chosen when it's cloned (§3.3).
- `<branch>`: the name of the branch checked out there. A branch name containing `/` becomes nested folders.

### 3.3. `devenv clone`

```text
devenv clone <url> [<name>]
```

- `<url>`: the URL of a git remote.
- `<name>`: the repository's name in devenv (§3.2).

Outputs: stdout `cloned <name> -> <path>`, where `<path>` is the default branch's worktree; diagnostics (§3.1).

### 3.4. `devenv worktree add`

```text
devenv worktree add <repo> <branch> [<base>]
```

- `<repo>`: a repository's name (§3.2).
- `<branch>`: the branch to check out.
- `<base>`: a commit, branch or tag to start a new branch from.

Outputs: stdout `worktree ready: <path>`; diagnostics (§3.1).

### 3.5. `devenv worktree rm`

```text
devenv worktree rm [<repo> <branch>] [--force]
```

- `<repo> <branch>`: the worktree to remove. Given together or not at all.
- `--force`: a switch.

Outputs: stdout `removed sandbox: <repo>/<branch>` when there was one, `removed: <path>`, and `deleted branch: <branch>` when the branch was deleted; diagnostics (§3.1).

### 3.6. `devenv worktree list`

```text
devenv worktree list [<repo>]
```

- `<repo>`: a repository's name (§3.2).

Outputs: stdout one line per worktree, `<repo>\t<branch>\t<path>`; diagnostics (§3.1).

## 4. Behavior

### 4.1. Invariants

These requirements apply to every command in §4.2 through §4.5.

#### 4.1.1. Failure

WHEN a command fails, it SHALL print `error: <message>` on stderr AND SHALL exit with status `1`.

#### 4.1.2. Missing arguments

WHEN a command is run without arguments it requires, and §4.4.1 doesn't apply, it SHALL print its usage line on stderr AND SHALL exit with status `1`, without changing anything.

#### 4.1.3. Relative links

WHEN a command creates a worktree, it SHALL create it with relative links between the worktree and its bare clone (`--relative-paths`), so they resolve the same way inside a sandbox ([ADR-0008](../adrs/0008-mirror-the-hosts-paths-in-every-sandbox.md)).

### 4.2. Cloning a repository

#### 4.2.1. Name

WHEN `<name>` is omitted, `devenv clone` SHALL use the last segment of `<url>`'s path, without a trailing `.git`.

#### 4.2.2. Bare clone

WHEN `devenv clone` clones a repository, it SHALL clone it as a bare repository at `worktrees/<name>/.git` AND SHALL configure it to fetch every branch of `origin` into `refs/remotes/origin/*` and fetch them, so the remote's branches are known and tracked.

> [!NOTE]
> A bare clone leaves `remote.origin.fetch` unset, so without this, fetching would only ever update `FETCH_HEAD`.

#### 4.2.3. Default branch

WHEN `devenv clone` has cloned a repository, it SHALL check out the remote's default branch as an ordinary worktree at `worktrees/<name>/<default-branch>`.

#### 4.2.4. Existing or failed target

IF `worktrees/<name>` already exists, THEN `devenv clone` SHALL fail without changing it. IF cloning or fetching fails, THEN `devenv clone` SHALL fail AND SHALL leave no `worktrees/<name>` behind.

### 4.3. Adding a worktree

#### 4.3.1. Unknown repository

IF `<repo>` has no bare clone in `worktrees/`, THEN `devenv worktree add` SHALL fail, naming `devenv clone` as the way to add it.

#### 4.3.2. Existing branch

WHEN `<branch>` exists as a local branch, or only on the remote as `origin/<branch>`, `devenv worktree add` SHALL check it out at `worktrees/<repo>/<branch>`, creating a local branch that tracks `origin/<branch>` in the latter case. `<base>` SHALL be ignored.

#### 4.3.3. New branch

WHEN `<branch>` exists neither locally nor on the remote, `devenv worktree add` SHALL create it from `<base>`, or from the repository's default branch when `<base>` is omitted, AND SHALL check it out at `worktrees/<repo>/<branch>`.

#### 4.3.4. Branch already checked out

IF `<branch>` is already checked out in another worktree, THEN `devenv worktree add` SHALL fail without creating anything.

### 4.4. Removing a worktree

`devenv worktree rm` removes a worktree together with everything devenv keeps for it. It checks everything that could stop it before removing anything, so it either removes all of it or changes nothing.

#### 4.4.1. Picking a worktree

WHEN `<repo>` and `<branch>` are omitted, `devenv worktree rm` SHALL offer an interactive picker over every worktree of every repository. IF `fzf` isn't installed, THEN it SHALL fail, saying to pass `<repo> <branch>` or install `fzf`. IF the picker is cancelled, THEN it SHALL exit with status `1` without changing anything.

#### 4.4.2. Running sandbox

IF the worktree's sandbox is running and `--force` isn't given, THEN `devenv worktree rm` SHALL fail without changing anything, naming `devenv container down <repo> <branch>` as the way to stop it.

#### 4.4.3. Uncommitted or unmerged work

IF the worktree has uncommitted changes or untracked files, as `git worktree remove` judges them, or its branch isn't fully merged, as `git branch -d` judges it, and `--force` isn't given, THEN `devenv worktree rm` SHALL fail without changing anything.

#### 4.4.4. Removal

WHEN nothing in §4.4.2 or §4.4.3 stops it, `devenv worktree rm` SHALL stop and remove the worktree's sandbox if it has one, as `devenv container down` does (RFC-0002), AND SHALL remove the sandbox's generated state and its Claude Code data, AND SHALL remove the worktree, AND SHALL delete its branch, AND SHALL remove any folders the removal left empty under `worktrees/<repo>/`.

#### 4.4.5. Default branch

WHEN the worktree being removed has the repository's default branch checked out, `devenv worktree rm` SHALL remove the worktree but SHALL NOT delete the branch.

> [!NOTE]
> The bare clone's `HEAD` names the default branch. Deleting it would leave `HEAD` naming a branch that doesn't exist, and §4.3.3 creates new branches from it.

#### 4.4.6. Force

WHEN `--force` is given, `devenv worktree rm` SHALL proceed past §4.4.2 and §4.4.3: it stops a running sandbox, discards uncommitted changes, and deletes a branch that isn't fully merged. §4.4.5 still applies.

### 4.5. Listing worktrees

#### 4.5.1. Every worktree

WHEN `<repo>` is omitted, `devenv worktree list` SHALL print one line per worktree of every repository, `<repo>\t<branch>\t<path>`, sorted by repository and then branch, with no line for the bare clones themselves.

#### 4.5.2. One repository

WHEN `<repo>` is given, `devenv worktree list` SHALL print only that repository's lines. IF `<repo>` has no bare clone in `worktrees/`, THEN it SHALL fail.

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

- Sandboxes themselves: creating, starting and stopping them, and how a worktree's sandbox is named. Specified in RFC-0002.
- Fetching, pulling, pushing and merging. devenv doesn't wrap them; they're plain git, run in a worktree or the bare clone.
- Renaming a repository or a branch, and moving a worktree.
- Repositories that devenv didn't clone, and checkouts outside `worktrees/` ([ADR-0006](../adrs/0006-check-out-every-branch-as-an-ordinary-worktree-of-a-bare-clone.md)).
- Removing a whole repository [future]. Today that's removing each worktree, then `worktrees/<repo>` by hand; a command for it would build on §4.4 for each worktree.
