---
adr: 0003
title: devenv owns the entire sandbox lifecycle
status: Proposed
date: 2026-07-11
see_also:
  - ADR-0001
  - ADR-0002
  - ADR-0004
---

# ADR 0003: devenv owns the entire sandbox lifecycle

## Decision

1. devenv MUST own a sandbox's entire lifecycle: creating and building it, starting it, rebuilding it, stopping it, and removing it along with its data.
2. Every one of those steps MUST be available through devenv itself, with no other tool required.

## Context

Agents run in a sandbox that limits what they can reach ([ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)), and devenv sets how they behave in it for every session however it was started ([ADR-0002](0002-let-agents-act-without-per-action-approval-inside-their-sandbox.md)). devenv already manages the repositories and worktrees agents work in.

VS Code's Dev Containers extension can run a container's whole lifecycle: it reads a project's dev container config when a folder is reopened in a container, builds and starts the containers, and stops them by default when the window closes. But it does so only while VS Code is the tool in use. A container it owns exists only once VS Code has brought it up, and an agent started any other way, such as from a terminal, has no sandbox until then.

The extension also has no notion of worktrees, so giving each worktree its own containers meant devenv copying the config into each project with per-worktree names substituted in. devenv was already doing part of the lifecycle, but the extension did the rest.

## Rationale

devenv is meant to be the one tool for working with agents: it is the tooling, and an editor is just one of the ways to work inside what devenv provides. The sandbox is the core of what it provides ([ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)), so devenv owns all of it, from creation to removal, rather than sharing it with an editor's extension.

Owning it whole also makes the lifecycle behave the same however someone works, from a terminal or from any editor, just as [ADR-0002](0002-let-agents-act-without-per-action-approval-inside-their-sandbox.md) does for how agents behave inside the sandbox. And it ends the split in which devenv prepared each worktree's config while another tool ran it.

## Alternatives

### VS Code's Dev Containers extension runs the lifecycle

Each project carries devenv's dev container config, copied in by `devenv devcontainer`, and VS Code builds, starts and stops it on "Reopen in Container" (the setup from 2026-05-26 until this decision).

**Rejected because** it splits the sandbox's lifecycle between devenv and an editor's extension, and makes running a sandbox depend on that editor being open.

## Consequences

- devenv implements the lifecycle itself, including what the editor extension provided: building, naming each worktree's containers, and attaching shells.
- Editor integrations that rely on the editor building the container, such as installing the extensions a config lists, don't happen on their own. An editor attaches to a container devenv already runs instead of reopening a folder in one.

## Confirmation

- `lib/container.sh` (`cmd_container_up`, `cmd_container_down`, `cmd_container_attach`): creating, building, starting, rebuilding, stopping and attaching are all `devenv container` commands.
- `lib/agent.sh` (`cmd_agent_up`): starting a background agent brings its sandbox up through the same path.
- `lib/worktree.sh` (`cmd_worktree_rm`): removing a worktree deletes its sandbox's Claude data.
- `lib/container.sh` (`_open_vscode`): opens VS Code on an `attached-container` URI, not a `dev-container` one, so VS Code attaches to the running container without reading or acting on its config.
- Not covered: `devenv worktree rm` leaves the worktree's containers and its generated state in `~/.local/state/devenv/<project>` behind, so removal isn't complete. Nothing stops VS Code's Dev Containers extension from opening a worktree's own `.devcontainer` directly, which builds and runs a container outside devenv, without its sandbox.
