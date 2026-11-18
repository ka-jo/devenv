---
adr: 0002
title: Let agents act without per-action approval inside their sandbox
status: Proposed
date: 2026-05-27
see_also:
  - ADR-0001
---

# ADR 0002: Let agents act without per-action approval inside their sandbox

## Decision

1. Coding agents that devenv runs MUST be able to act inside their sandbox without stopping to ask for approval of individual actions, such as permission prompts or folder trust dialogs.
2. devenv MUST own the agent tool's permission mode inside the sandbox, setting it for every agent session however that session was started (a terminal, a background agent, an attached IDE). IDE settings and per-machine user settings outside of devenv's control MUST NOT be what sets it.
3. An agent tool's own controls MAY stay on inside the sandbox, as long as they don't stop the agent to ask for approval.

## Context

Agents run inside a sandbox that limits what they can reach, enforced from outside it ([ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)).

By default Claude Code asks before it runs a command, edits a file, or fetches from the network, and each prompt stops the agent until someone answers. It can be told to skip these prompts (`bypassPermissions` mode), after a confirmation of its own.

Coding agents are most useful when they can work on a repository for long stretches without someone approving each step.

A Claude Code session can be started from more than one place: a terminal in the dev container, or an IDE attached to it, such as the VS Code extension. Its behavior comes from several settings layers: IDE extension settings, user and project settings, and managed settings.

## Rationale

Per-action prompts exist to stop actions that could do harm. Inside the sandbox, [ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md) already bounds what any action can harm, so the prompts protect little while stopping every unattended run.

Setting this once, from devenv, makes every session in a sandbox behave the same whichever tool started it. Leaving it to an IDE's or a machine's settings would make an agent's behavior depend on how it was launched.

## Alternatives

### Claude Code's permission prompts with allow rules

Keep Claude Code's per-action prompts, with `permissions.allow` rules pre-approving routine commands.

**Rejected because** any action outside the allow rules still stops the agent until someone answers, which rules out unattended work, while inside the sandbox those prompts guard little.

### IDE settings

Enable bypass through the dev container's VS Code customizations: `claudeCode.allowDangerouslySkipPermissions` (a6bc9d1), then `claudeCode.initialPermissionMode: bypassPermissions` (7bb7da0).

**Rejected because** it ties agent behavior to one IDE. Sessions started from a terminal, as background agents, or from another tool would behave differently.

## Consequences

- An agent acts without any per-action review, interactive sessions included.
- devenv has to turn off each agent tool's approval prompts itself, for every way a session can start, and keep doing so as tools add new kinds of prompt.
- Turning prompts back on doesn't require revisiting [ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md); the sandbox holds either way.

## Confirmation

- `devcontainer/managed-settings.json` (Claude Code managed settings): sets `permissions.defaultMode: bypassPermissions` and `skipDangerousModePermissionPrompt`. Managed settings outrank IDE, user and project settings, so every session gets them.
- `devcontainer/features/agent/install.sh` (image build): links `/etc/claude-code/managed-settings.json` to that file under the read-only `~/devenv` mount, in every image devenv builds.
- `devcontainer/generator/src/config.ts` (`deriveGeneratedConfig`): adds the `agent` Feature to every generated config, whatever config it was generated from.
- `devcontainer/generator/test/config.test.ts` (spec): asserts the `agent` Feature is injected; catches a config that would skip it.
- `lib/container.sh` (`_container_seed_claude_data`): seeds each worktree's `.claude.json` with onboarding completed and the worktree trusted, so Claude Code's first-run screens don't stop the first session.
- Not covered: a Feature that a project config installs after `agent` could replace `/etc/claude-code/managed-settings.json`, and nothing checks for that. Nothing checks that every way of starting a session ends up without prompts.
