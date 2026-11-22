---
rfc: 0003
title: Config resolution
status: Draft
see_also:
  - ADR-0004
  - ADR-0006
  - RFC-0002
  - RFC-0004
  - RFC-0005
  - RFC-0007
---

# RFC 0003: Config resolution

## 1. Summary

This RFC specifies how devenv resolves which dev container config a worktree's sandbox is defined by: from a config named with `--config`, the config the worktree last used, or a config inside the worktree. Every command that validates, approves or builds from a config resolves it this way first.

## 2. Motivation

A sandbox is defined by a dev container config ([ADR-0004](../adrs/0004-define-sandboxes-with-standard-dev-container-configs.md)), and each worktree has a sandbox of its own (RFC-0002). A worktree may hold its own config, several, or none, and a config can also live outside any worktree. Before a config can be validated (RFC-0004), approved (RFC-0005) or built from (RFC-0007), devenv has to know which one it is, and every command needs the same answer, or one command would approve a different config than another builds from. This RFC specifies that answer once, for every command that needs it.

## 3. Interface

### 3.1. Inputs

- `--config <path>`, `--config=<path>`: an option of every command that resolves a config. It names a `devcontainer.json`, or a folder holding one.
- The worktree's recorded `sourceConfig` (RFC-0007 §3.3): the absolute path of the config last given to `devenv container up` with `--config`.
- The worktree's own config files: `.devcontainer/devcontainer.json` and `.devcontainer.json`.

### 3.2. The resolved config

- **The config**: the absolute path of the `devcontainer.json` resolved as §4 specifies.
- **The config's folder**: the folder holding the config's `.devcontainer/` folder, or else the folder holding the config itself.

## 4. Behavior

Every command that runs config validation (RFC-0004) first resolves which config to validate, the same way: from `--config` when it's given, otherwise from the config the worktree last used with `--config` (its recorded `sourceConfig`, RFC-0007 §3.3), otherwise from the worktree's own `.devcontainer/devcontainer.json` or `.devcontainer.json`. devenv is _resolving the worktree's config_ while any such command does this.

### 4.1. Relative paths

WHILE devenv is resolving the worktree's config, WHEN `--config` is given a relative path, devenv SHALL resolve it against the current directory.

### 4.2. Precedence

WHILE devenv is resolving the worktree's config, WHEN `--config` is given, devenv SHALL use the config `--config` names (§4.3).

WHILE devenv is resolving the worktree's config and the worktree has a recorded `sourceConfig` (RFC-0007 §3.3), WHEN `--config` is omitted, devenv SHALL use the `sourceConfig`.

WHILE devenv is resolving the worktree's config, the worktree has no recorded `sourceConfig`, and it has a `.devcontainer/devcontainer.json`, WHEN `--config` is omitted, devenv SHALL use the worktree's `.devcontainer/devcontainer.json`.

WHILE devenv is resolving the worktree's config, the worktree has no recorded `sourceConfig` and no `.devcontainer/devcontainer.json`, and it has a `.devcontainer.json`, WHEN `--config` is omitted, devenv SHALL use the worktree's `.devcontainer.json`.

### 4.3. Files and folders given with `--config`

WHILE devenv is resolving the worktree's config, WHEN `--config` names a file, devenv SHALL use the file `--config` names.

WHILE devenv is resolving the worktree's config, WHEN `--config` names a folder that has a `.devcontainer/devcontainer.json`, devenv SHALL use the folder's `.devcontainer/devcontainer.json`.

WHILE devenv is resolving the worktree's config, WHEN `--config` names a folder that has no `.devcontainer/devcontainer.json` and has a `.devcontainer.json`, devenv SHALL use the folder's `.devcontainer.json`.

WHILE devenv is resolving the worktree's config, WHEN `--config` names a folder that has neither a `.devcontainer/devcontainer.json` nor a `.devcontainer.json`, and has a `devcontainer.json`, devenv SHALL use the folder's `devcontainer.json`.

### 4.4. Nothing to use at `--config`

WHILE devenv is resolving the worktree's config, IF `--config` names a path that doesn't exist, THEN devenv SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST name the path.

WHILE devenv is resolving the worktree's config, IF `--config` names a folder holding none of the files in §4.3, THEN devenv SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST name the folder AND MUST list the file names devenv looked for.

### 4.5. Last-used config gone

WHILE devenv is resolving the worktree's config, the worktree has a recorded `sourceConfig` (RFC-0007 §3.3), and there is no file at the path the `sourceConfig` records, WHEN `--config` is omitted, devenv SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST name the path the `sourceConfig` records. It MUST name `--config <path>` as the way to choose another config.

### 4.6. Configs only in subfolders

WHILE devenv is resolving the worktree's config, the worktree has no recorded `sourceConfig` and neither a `.devcontainer/devcontainer.json` nor a `.devcontainer.json`, and it has one or more `.devcontainer/<folder>/devcontainer.json` files, WHEN `--config` is omitted, devenv SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST list those folders. It MUST name `--config <path>` as the way to choose one.

## 5. Examples

### 5.1. A recorded config wins over the worktree's own

Setup: `worktrees/app/main` has its own `.devcontainer/devcontainer.json`, and an earlier `devenv container up app main --config ~/configs/app` recorded `/home/dev/configs/app/.devcontainer/devcontainer.json` as its `sourceConfig`.

Call: `devenv container validate app main`

Result: the config is `/home/dev/configs/app/.devcontainer/devcontainer.json`, and its folder is `/home/dev/configs/app`. The worktree's own config is ignored until another config is given with `--config`.

## 6. Out of scope

- Recording a config given with `--config` for later runs. Only `devenv container up` does that (RFC-0007).
- What's done with the config once it's resolved: validating it (RFC-0004), approving it (RFC-0005), and building from it (RFC-0007).
- A worktree with no config at any of the paths in §4.2 [future]. A later RFC specifies it.
