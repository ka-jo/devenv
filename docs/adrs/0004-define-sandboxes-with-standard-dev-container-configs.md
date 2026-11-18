---
adr: 0004
title: Define sandboxes with standard dev container configs
status: Proposed
date: 2026-10-25
see_also:
  - ADR-0001
  - ADR-0003
  - https://containers.dev
---

# ADR 0004: Define sandboxes with standard dev container configs

## Decision

1. A sandbox's environment MUST be defined by a config in the Development Container Specification's format, and devenv MUST build and run it with an implementation of that specification rather than interpreting configs itself.
2. A project MAY supply its own config to shape its sandboxes for its own needs. devenv provides a default for projects that don't.
3. What devenv requires of every sandbox, its limits under [ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md) and its agent tooling, MUST be applied by devenv on top of whichever config is used, never required to be written into the config.
4. devenv SHOULD NOT add a convention of its own for anything the specification can already express.

## Context

devenv creates, starts and stops sandboxes itself, without an IDE ([ADR-0003](0003-devenv-owns-the-entire-sandbox-lifecycle.md)). Agents run in a sandbox whose limits are enforced by something the agent can't change from inside it ([ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)).

Projects differ in what their agents need: language toolchains, system packages, and services such as databases.

The Development Container Specification is an open standard for describing a development container: from an image, a Dockerfile or a Compose file, with reusable Features that add tooling and hooks that run at points in the container's life. It has a reference CLI that builds and runs such containers without an IDE, and IDEs and hosted tools support it. Many repositories already carry a config in that format.

A project's own config lives in its repository, which agents in that project's sandboxes can write.

## Rationale

The specification already gives projects an approachable, widely known way to describe their environment, Features included, so a project can tailor its sandboxes without devenv defining a format or convention of its own. Its reference CLI is an engine that devenv can drive directly, which keeps the lifecycle in devenv's hands ([ADR-0003](0003-devenv-owns-the-entire-sandbox-lifecycle.md)).

A config in the repository is writable by the agents it would constrain, so the sandbox's limits can't come from it ([ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)). Applying them on top of the config keeps them out of the agent's reach and lets a config work without containing anything devenv-specific.

## Alternatives

### Plain Docker Compose with devenv's own files

devenv's own Compose file and Dockerfile, run directly with `docker compose` (020c55e, until this decision).

**Rejected because** each project would need a devenv-specific convention to adjust its own container, where the dev container specification already provides an approachable, widely supported one.

## Consequences

- devenv depends on the reference CLI's behavior and pins its version.
- A config is code that runs at build time, as root with full network access, outside any sandbox: its Dockerfiles, Feature install scripts and base images. Accepting projects' own configs needs a safeguard of its own, recorded as a follow-up decision.
- Some things a config can express work against the sandbox or against running several worktrees side by side: published ports, fixed container names and subnets, host mounts, and commands that run on the host (`initializeCommand`). devenv has to reject or override them.
- Only Compose-based configs are supported so far, because devenv's layer is applied as a Compose override. Supporting image- and Dockerfile-based configs is future work; it has to cover `runArgs`, which pass arbitrary `docker run` arguments.

## Confirmation

- `package.json` (root devDependency): pins `@devcontainers/cli`, the engine every sandbox is built and run with.
- `lib/container.sh` (`_devcontainer`): runs that CLI for every build, start and exec.
- `devcontainer/generator/src/source.ts` (`resolveSourceConfig`): uses a project's own `.devcontainer/devcontainer.json` or `.devcontainer.json` when it has one, otherwise devenv's default; `--config` picks any other.
- `devcontainer/default/devcontainer.json` (default config): a plain specification config for projects without their own.
- `devcontainer/generator/src/config.ts` (`deriveGeneratedConfig`) and `devcontainer/generator/src/override.ts` (`buildOverride`): add devenv's agent Feature and apply its limits on top of the config, without requiring anything of it.
- `devcontainer/generator/test/config.test.ts`, `devcontainer/generator/test/override.test.ts` (specs): pin what's added on top of a config.
- Not covered: image- and Dockerfile-based configs, which `deriveGeneratedConfig` rejects. Nothing checks that devenv adds no convention the specification already covers.
