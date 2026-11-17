---
adr: 0001
title: Run agents in a sandbox that limits what they can reach
status: Proposed
date: 2026-05-26
see_also:
  - ADR-0002
---

# ADR 0001: Run agents in a sandbox that limits what they can reach

## Decision

1. Coding agents that devenv runs MUST run inside a sandbox that limits what they can reach. This covers every agent session devenv starts or hosts. Agents run directly on the host, outside devenv, are out of scope.
2. Every limit on what an agent can reach outside its sandbox, including the host's files and processes, the network, other repositories, and credentials, MUST be enforced by something the agent can't change from inside the sandbox.
3. devenv MUST NOT count an agent tool's own controls (permission prompts and rules, trust dialogs, the tool's own sandboxing) as one of those limits.
4. Anything an agent can change SHOULD belong to its own sandbox alone, not be shared with other sandboxes or the host. Sharing something writable is acceptable when there's a stated reason for it.

## Context

A coding agent such as Claude Code acts through its own process: it runs commands, edits files, and makes network requests. Whatever that process can do, the agent can do.

On the host machine, that is a lot. The process can read and write every repository and file its host account can, use whatever credentials that account's home directory holds, reach any network destination including the local network, and change configuration that other tools on the host later execute, such as shell startup files, git hooks, and editor and Claude Code settings.

An agent can cause damage by mistake, or because content it reads (a web page, an issue, a dependency's files) steers it. Whatever it's allowed to do, it may do for either reason.

Agent tools ship controls of their own, but those controls live inside the environment they're meant to restrict. Claude Code asks before it runs a command, edits a file, or fetches from the network, and it has permission rules, a trust dialog for unfamiliar folders, and sandboxing for the commands it runs. All of them are configured through settings files that the agent's own process can usually write, such as the project settings in the repository it's working on, and they're enforced by Claude Code itself, the tool they're meant to limit. Its prompts also protect only while someone reads each one carefully.

## Rationale

Reviewing what an agent does doesn't hold up as the safety mechanism. A person approving a long stream of actions stops reading them, and a steered action can look harmless. So safety has to come from limiting what an agent can reach.

A limit only holds if the agent can't loosen it, by mistake or because injected content told it to. A limit enforced from outside the sandbox holds no matter what the agent does inside it. An agent tool's own controls are configured and enforced within the environment being limited, by the tool being limited, so devenv doesn't rely on them.

Within those limits, the worst an agent can do is damage what's inside its sandbox, which is bounded and mostly recoverable from version control. Writable state shared between sandboxes would let that damage spread from one sandbox to the others, so by default each sandbox's writable state is its own.

## Alternatives

### Claude Code's own sandbox

Use Claude Code's built-in sandboxing of the commands it runs as the boundary, instead of an environment around the agent.

**Rejected because** it is a boundary owned and configured by one agent tool, limiting only what that tool launches, whereas devenv needs one boundary that holds whatever agent or tool runs inside it. It remains compatible as an extra layer inside the sandbox, as long as no limit depends on it.

## Consequences

- An agent can damage anything inside its sandbox, including uncommitted work in the repository it's working on. The sandbox bounds that damage; it doesn't prevent it.
- Every way into or out of the sandbox becomes something devenv has to enforce and keep enforcing: network egress, host files and credentials made visible inside, and the definition of the sandbox itself. With nothing behind the sandbox, each gap is a full escape. Follow-up decisions record how each is closed.
- Widening a sandbox, whether letting traffic out to a new destination or changing what the sandbox is built from, can only be done from outside it.
- The pnpm store is shared, writable, by every sandbox, so packages are downloaded and stored once. A sandbox that tampers with it affects the others' installs.
- Migration debt at this date: the first dev container template mounts the host's `~/.claude` and `~/devenv` read-write, which lets an agent change configuration the host's Claude Code runs and follows.

## Confirmation

- `devcontainer/generator/src/override.ts` (`agentLayer`, `networkOverrides`): puts the agent's container on the internal proxy network only, forces the project's own networks internal, mounts `~/devenv` read-only, and pins the host-trusted git paths read-only. The override is generated into a host-only state dir outside the worktree, so the agent can't edit it.
- `devcontainer/infra/firewall/squid.conf` (Squid ACLs): default-deny egress, enforced in a separate container that the agent reaches only as a proxy.
- `devcontainer/infra/docker-compose.yml` (networks): keeps the approver off the agent's network, so whether to widen egress is decided outside the sandbox.
- `devcontainer/generator/src/validate.ts` (config validation): blocks dev container configs that would give the sandbox host privileges, host namespaces, devices, runtime sockets, or a network path around the proxy; catches a config in the agent-writable worktree taking the sandbox apart.
- `devcontainer/generator/src/trust.ts` (config approval): a sandbox is only built from config content approved from the host, so changing what the sandbox is built from takes action outside it.
- `devcontainer/generator/test/override.test.ts`, `devcontainer/generator/test/validate.test.ts`, `devcontainer/generator/test/source-and-trust.test.ts` (specs): pin the generated limits, the validator's rules, and approval by content.
- Not covered: nothing tests the sandbox as a whole from inside a running container. `devcontainer/infra/firewall/verify.sh` was meant to check egress, but it still reads the allowlist from a pre-shared-stack path and isn't run by anything. Each worktree's bare repo is mounted read-write, so an agent can change other branches' refs, which are shared with that repo's other worktrees. Not counting an agent tool's own controls as a limit is enforced by convention only.
