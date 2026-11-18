---
adr: 0005
title: Approve every dev container config's exact content before building from it
status: Proposed
date: 2026-11-02
see_also:
  - ADR-0001
  - ADR-0004
---

# ADR 0005: Approve every dev container config's exact content before building from it

## Decision

1. devenv MUST NOT build or create a sandbox from a dev container config until a person has reviewed and approved it. This applies to every config, wherever it comes from.
2. An approval MUST cover the config's exact content, including the files its build uses that devenv can identify. Any change MUST be approved again before devenv builds from the changed config.
3. Approval MUST NOT override [ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md): a config that would let an agent change or get around its sandbox's limits from inside it is rejected whether or not it has been approved.
4. A reviewer MAY approve a config that exposes host files to the sandbox. devenv warns about such exposure rather than blocking it.

## Context

Sandboxes are defined by dev container configs, and a project can supply its own ([ADR-0004](0004-define-sandboxes-with-standard-dev-container-configs.md)). A config can live in a project's repository or elsewhere on the host.

The sandbox limits what an agent can reach once it's running ([ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)), but building one runs the config's own code first: its Dockerfile steps and the install scripts of its Features, as root, with full network access, before any of the sandbox's limits exist.

A config in a project's repository can be changed by the agents working in it. A config kept somewhere agents can't write is out of their reach, but its build still pulls images and Features from registries and runs whatever they contain.

devenv can check a config for known ways out of a sandbox, such as host privileges, host namespaces, devices, container runtime sockets, and network routes around the egress proxy. But it can't judge what a build step does, what a Feature installs, or whether a host path is safe to expose, which depends on what's in it. Host paths also have legitimate uses, such as caches, shared tooling, and configs kept outside a repository.

## Rationale

Building a sandbox is the one point where a config's code runs with no sandbox around it, so a person looks at the config before that happens. Automated checks catch the known escapes; review covers what those checks can't judge mechanically.

Approval covers the exact content because a config reviewed once could otherwise change before it's built, whether an agent in the repository edited it or a change arrived from elsewhere. Requiring approval again for any change keeps what's built identical to what was reviewed.

The rule applies to every config because where a config lives doesn't change what its build runs. One rule for every config is also simpler to reason about than a list of sources that are exempt.

Exposing host files is left to the reviewer because it has legitimate uses and its safety depends on what's exposed, which a person can judge and validation can't. A config that would let an agent change or get around its limits stays blocked regardless, since approving one would end the sandbox [ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md) requires. Approvals are given and recorded outside every sandbox, so an agent can't approve its own config ([ADR-0001](0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)).

## Alternatives

### Approve only configs in a project's repository

Require approval only for configs that agents can write, and build any other config without review (08e5948, until this decision).

**Rejected because** where a config lives doesn't change what its build runs, and one rule for every config is simpler to reason about than a list of exempt sources.

### Reject host paths outside the project

Block any config that mounts or references a host path outside the project's worktree, rather than leaving it to the reviewer (08e5948, until this decision).

**Rejected because** configs have legitimate reasons to use host paths, and whether a given path is safe to expose depends on what's in it, which a reviewer can judge and validation can't.

## Consequences

- Every new config, and every change to one, stops at review before it can be built, including changes that arrive with a pull.
- Review is only as good as the reading: an approved config can still expose host files or run harmful build steps that the reviewer missed.
- Some host exposure is an escape that validation can't recognize. A writable mount of a file that host tools execute, such as a shell startup file or a git hook, lets an agent run code on the host, but it looks the same to validation as a harmless cache directory. Telling the two apart is the reviewer's job.
- What approval covers is limited to the files devenv can identify as the config's. A build context outside the config's folder, or an image pulled by a tag that's later moved, can change what's built without a new review.

## Confirmation

- `devcontainer/generator/src/generate.ts` (`generateWorktreeConfig`): refuses to build or create a sandbox from a config whose content hasn't been approved; catches new and changed configs.
- `devcontainer/generator/src/trust.ts` (`collectConfigSet`, `approveConfigSet`): approval is of a hash over every file the config builds from that devenv can identify (compose files, the Dockerfiles they build, local Features, the rest of the config's folder), and records exactly what the reviewer was shown.
- `devcontainer/generator/src/trust-cli.ts` (`devenv container trust`): shows the config as a diff against its last approved version and records approval on confirmation, run on the host.
- `lib/container.sh` (`TRUST_DIR`): approvals live under the host-only state dir, which no sandbox mounts.
- `lib/container.sh` (`_container_up`): stops a sandbox's containers before checking its config for a rebuild, so the config can't change between being checked and being built.
- `devcontainer/generator/src/validate.ts` (`isSandboxEscape`): a sandbox escape blocks creation regardless of approval; host exposure (`host-paths`, `volume-driver-opts`, `config-folder`) only warns.
- `devcontainer/generator/test/source-and-trust.test.ts`, `devcontainer/generator/test/validate.test.ts` (specs): pin approval by content and which rules block or warn.
- Not covered: build contexts outside the config's folder and images pulled by tag, as above.
