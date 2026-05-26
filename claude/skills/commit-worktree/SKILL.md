---
name: commit-worktree
description: This skill should be used when the user asks to "commit worktree", "atomize commits", "split commits", "break up changes into commits", "organize uncommitted changes into commits", or wants to turn a large dump of uncommitted work into a series of logical, atomic commits.
version: 1.0.0
---

# commit-worktree

To break uncommitted changes in a worktree into a series of logical, atomic commits.

## When to Use

Use when the current worktree (or a specified one) has a pile of uncommitted changes that should be split into well-structured commits rather than committed as a single dump.

## Invocation

The skill accepts an optional worktree path argument:

- No argument: operate on the current working directory
- Path argument: operate on that directory via `git -C <path>`

Example invocations:

- `/commit-worktree`
- `/commit-worktree ../my-feature`
- `/commit-worktree /abs/path/to/worktree`

## Process

### 1. Gather the diff

Run the following to understand all changes (staged and unstaged):

```bash
git [-C <path>] status
git [-C <path>] diff
git [-C <path>] diff --cached
```

Also check for untracked files that should be included:

```bash
git [-C <path>] ls-files --others --exclude-standard
```

### 2. Analyze and plan commits

Read the full diff carefully. Group changes into logical, atomic units — each commit should represent one coherent change. Good groupings to consider:

- Changes to a single module, package, or feature area
- A refactor separated from a behavior change
- New files (e.g. a new component or utility) separate from the code that uses them
- Config/tooling changes separate from application changes
- Bug fixes separate from feature work

Present the proposed commit plan to the user **before making any commits**. List each proposed commit with:

- Its commit message (using any relevant commit conventions)
- A summary of which files/hunks it includes

Wait for user confirmation or feedback before proceeding.

### 3. Execute commits

After approval, execute each commit in order using `git add -p` (interactive patch staging) or by staging specific files, then committing. Use `git -C <path>` throughout if a path was provided.

For each commit:

1. Stage only the relevant files/hunks
2. Verify staged diff with `git diff --cached`
3. Commit with the agreed message

### 4. Confirm

After all commits are made, run `git log --oneline -n <count>` to show the user the resulting commit history.

## Commit Conventions

Follow any commit conventions (e.g. Conventional Commits, Angular, etc.) specified by the user or project settings. If no such convention is documented, default to using [Conventional Commits](https://www.conventionalcommits.org/), but clearly indicate to the user that no convention was found and that the default is being used, allowing them to specify another convention.

## Key Constraints

- Never commit without user approval of the plan first
- Never use `git add .` or `git add -A` — stage precisely to keep commits atomic
- Never skip hooks (`--no-verify`)
- Prefer creating new commits over amending existing ones
- If a hunk genuinely belongs to multiple logical changes, split it with `git add -p` and patch interactively
