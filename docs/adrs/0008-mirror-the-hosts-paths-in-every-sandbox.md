---
adr: 0008
title: Mirror the host's paths in every sandbox
status: Proposed
date: 2026-11-16
see_also:
  - ADR-0001
  - ADR-0006
  - ADR-0007
---

# ADR 0008: Mirror the host's paths in every sandbox

## Decision

1. The devenv repo MUST live at `~/devenv` on the host, and every sandbox MUST mount it, and with it every worktree and bare clone inside it, at the same path relative to the sandbox user's home directory.
2. Claude Code's config directory MUST be at `~/.claude`, beside the repo, on the host and in every sandbox.
3. A sandbox MUST NOT mount its worktree only at a path of its own, such as `/workspace`.
4. A config MAY also mount the worktree at an additional path of its own choosing.
5. Anything MAY refer to a file by its `~/devenv` or `~/.claude` path and expect it to resolve the same way on the host and in every sandbox.

## Context

Every branch is checked out as a worktree of a bare clone kept in devenv's own directory ([ADR-0006](0006-check-out-every-branch-as-an-ordinary-worktree-of-a-bare-clone.md)), and each worktree has a sandbox that mounts its files from the host ([ADR-0007](0007-give-each-worktree-one-sandbox-shared-by-every-agent-working-in-it.md)). Agents use git inside the sandbox, and people work with the same worktrees from the host.

Git links a worktree and its bare clone in both directions, and devenv creates worktrees with `--relative-paths`, so both links are relative. devenv's own Claude Code configuration (its skills, rules and instructions) lives in the repo and is linked into Claude Code's config directory with relative links too, and skills and instructions name devenv's files by their `~/devenv` paths. But a relative link only resolves where the layout between its two ends is the same as where it was written, and a path only works on both sides if it names the same file on both.

Sandboxes run as whatever user their image defines, so the sandbox user's home directory differs from one image to the next, and usually from the host user's. But devenv generates a sandbox's mounts before the container exists, and an image's user and home aren't known until the image is built.

## Rationale

A path should mean the same thing on the host and in a sandbox. Mounting everything devenv shares with a sandbox at the same place relative to the home directory keeps the layout identical on both sides, so the relative links git and devenv write on one side resolve on the other, and a path written on one side works on the other. That's what lets agents use git inside a sandbox on the same worktrees people use from the host.

The mirror is relative to the home directory, not absolute, because the host user's and the sandbox user's homes differ. Mounting under the sandbox user's own home also makes `~` mean the same thing to every tool inside the sandbox as on the host.

## Alternatives

### A fixed workspace path

Mount the worktree at a fixed path such as `/workspace`, as dev container configs commonly do (from 2026-05-26 until caac3dc, 2026-10-22).

**Rejected because** the worktree's relative links to its bare clone don't resolve from there, so git doesn't work inside the sandbox.

### Fixed paths at the filesystem root

Mount the repo at `/devenv` and Claude Code's config at `/.claude`, pointing Claude Code at it with `CLAUDE_CONFIG_DIR`, with worktrees mounted relative to the repo there, so the mounts work for any image and user without knowing their home (f61ebce, 2026-10-28 until this decision).

**Rejected because** `~/devenv` paths then mean something different inside a sandbox than on the host.

## Consequences

- A worktree's path inside a sandbox follows devenv's layout rather than a short, fixed path. devenv sets a config's workspace folder to it, replacing whatever the config asks for.
- Creating a sandbox builds its image first, to learn its user's home before generating the mounts, and records that home for the sandbox's later starts.
- The bare clone has to be mounted into the sandbox as well, so what host-side git trusts in it has to be protected from the sandbox ([ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)).
- The host and every sandbox image need a git that understands relative worktree links (2.48 or later).
- devenv refuses to install anywhere other than `~/devenv`.
- Migration debt at this date: sandboxes created with the root-level layout keep it until they're rebuilt.

## Confirmation

- `install.sh` (location check): fails unless the repo is at `~/devenv`.
- `lib/clone.sh` (`cmd_clone`), `lib/worktree.sh` (`cmd_worktree`): create every worktree with `--relative-paths`.
- `lib/link.sh` (`_link_relative`): links devenv's Claude Code config with relative links, which resolve wherever the two directories are siblings.
- `devcontainer/features/agent/install.sh` (image build): records the sandbox user's home in `/etc/devenv/home`, and fails the build when the image's git is older than 2.48.
- `lib/container.sh` (`_container_build_and_locate_home`, `_image_home`): on creation, builds the image, reads the recorded home from a container that is never started, and records it in the sandbox's `meta.json`.
- `devcontainer/generator/src/context.ts` (`parseGeneratorContext`): derives the repo's and Claude Code's mount points from that home, as `~/devenv` and `~/.claude`.
- `devcontainer/generator/src/paths.ts` (`containerPathOf`): maps a host path under the repo to the same relative path under the repo's mount in the sandbox.
- `devcontainer/generator/src/override.ts` (`agentLayer`, `mirrorMount`): mounts the repo, Claude Code's config dir, the worktree, its `.git` file, the bare clone and the worktree's administrative directory at their mirrored paths, and sets `CLAUDE_CONFIG_DIR`.
- `devcontainer/generator/src/config.ts` (`deriveGeneratedConfig`): sets the workspace folder to the worktree's mirrored path, with a notice when it replaces the config's own.
- Not covered: nothing checks from inside a running sandbox that git can resolve its worktree. Sandboxes created before the home was recorded keep the root-level layout until rebuilt.
