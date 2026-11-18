---
adr: 0007
title: Give each worktree one sandbox, shared by every agent working in it
status: Proposed
date: 2026-07-11
see_also:
  - ADR-0001
  - ADR-0006
---

# ADR 0007: Give each worktree one sandbox, shared by every agent working in it

## Decision

1. devenv MUST give each worktree its own sandbox, and every agent session working in that worktree MUST run in that sandbox.
2. The sandboxes of different worktrees MUST be able to run at the same time without interfering with each other, including worktrees of the same repository built from the same config.

## Context

Agents run in a sandbox that limits what they can reach ([ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)), but that decision doesn't say how much one sandbox covers: one agent session, one worktree, or more.

Every branch is checked out as its own worktree ([ADR-0006](0006-check-out-every-branch-as-an-ordinary-worktree-of-a-bare-clone.md)). Agents do their work by changing a worktree's files, and more than one agent can work in the same worktree. Agents on different branches work in different worktrees, often at the same time.

A sandbox is a stack of containers, sometimes with services such as databases alongside, and each one takes time to build and start and resources to keep running. But agents sharing a worktree share its files whatever surrounds them: each sandbox would have to mount the same checkout, writable, so any agent there can change what the others are working on.

## Rationale

The worktree is the unit an agent's work is separated by. Its files are what agents change, so a sandbox per worktree draws the boundary exactly where the files differ: an agent on one branch can't reach another branch's checkout. Splitting one worktree into several sandboxes would add a stack per agent without separating what the agents can actually damage, since all of them still share the files.

Agents work on several branches at once, so the sandboxes of different worktrees run side by side and nothing in one may collide with another.

## Alternatives

### One sandbox per agent session

Each agent session, each background agent included, gets a sandbox of its own.

**Rejected because** agents in the same worktree share its files anyway, so a sandbox each would multiply the stacks to build and run without separating what they can damage, and nothing yet needs agents within one worktree kept apart. It would become worth revisiting if they ever do, for example to give them different credentials.

## Consequences

- Agents in one worktree can interfere with each other: with its files, its processes, and the Claude Code data the sandbox keeps.
- Every worktree with a running sandbox costs one stack, its services included.
- Everything that identifies a sandbox, such as its containers, networks and data, is named per worktree, from its repository and branch.
- Worktrees of the same repository share their bare clone ([ADR-0006](0006-check-out-every-branch-as-an-ordinary-worktree-of-a-bare-clone.md)), which every one of their sandboxes mounts.

## Confirmation

- `lib/container.sh` (`_compose_project_name`, `_container_resolve`): one Compose project per worktree, named `<repo>-<branch>`, so each worktree's containers and networks are its own.
- `devcontainer/generator/src/override.ts` (`buildOverride`): names the primary container after the worktree's project, and removes a config's fixed container names and subnets, which would collide across worktrees.
- `lib/agent.sh` (`cmd_agent_up`, `_agent_claude`): background and interactive agents alike run in the worktree's one sandbox.
- `lib/container.sh` (`DATA_DIR`): each worktree's Claude Code data lives in a directory of its own.
- Not covered: nothing separates agents working in the same worktree from each other.
