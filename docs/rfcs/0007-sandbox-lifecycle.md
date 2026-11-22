---
rfc: 0007
title: Sandbox lifecycle
status: Draft
see_also:
  - ADR-0001
  - ADR-0003
  - ADR-0004
  - ADR-0005
  - ADR-0007
  - ADR-0008
  - RFC-0002
  - RFC-0006
  - RFC-0004
  - RFC-0005
  - RFC-0008
---

# RFC 0007: Sandbox lifecycle

## 1. Summary

This RFC specifies how devenv runs a worktree's sandbox: how a sandbox is named, the state devenv keeps for it, how its config is resolved, and the commands that bring it up, take it down, open a shell in it and list sandboxes. What a sandbox contains, the checks its config must pass, and the shared egress stack are specified in RFCs of their own, which this one refers to at the point in the lifecycle where each applies.

## 2. Motivation

devenv owns a sandbox's entire lifecycle ([ADR-0003](../adrs/0003-devenv-owns-the-entire-sandbox-lifecycle.md)), and each worktree has one sandbox, shared by every agent working in it ([ADR-0007](../adrs/0007-give-each-worktree-one-sandbox-shared-by-every-agent-working-in-it.md)). A sandbox is built from a dev container config ([ADR-0004](../adrs/0004-define-sandboxes-with-standard-dev-container-configs.md)) that must pass config validation (RFC-0004) and have its exact content approved (RFC-0005) before anything is built from it ([ADR-0005](../adrs/0005-approve-every-dev-container-configs-exact-content-before-building-from-it.md)). Everything devenv generates for a sandbox stays on the host, out of every sandbox's reach ([ADR-0001](../adrs/0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)).

Prior to this RFC, the lifecycle differed from what is specified here:

- devenv kept a sandbox's state in two places: the config last used and the inputs hash in a `customizations.devenv` record inside the generated `devcontainer.json`, and how to reach the container in a separate `meta.json` (§3.2).
- devenv recorded every config it resolved as the one to use from then on, not only one chosen with `--config`, so a worktree kept using that config even after it gained a different one of its own (§4.2.2).
- `devenv container attach` regenerated the sandbox's config and override and reran the config's checks before opening a shell, and always ran `zsh` through the devcontainer CLI's `exec` (§4.5).
- The repository part of a sandbox name wasn't lowercased or normalized, and nothing stopped two worktrees from having the same sandbox name (§3.1, §4.3.1).
- Some lifecycle errors were printed on stdout (RFC-0001 §4.2).
- `devenv container`'s usage text described `list` as listing running containers only (§4.6).

## 3. Interface

### 3.1. Sandbox name

Each worktree's sandbox has a name, derived from the worktree's repository and branch (RFC-0002 §3.1): `<repo>/<branch>` lowercased, with each run of characters other than `a`–`z` and `0`–`9` replaced by a single `-`, and any `-` at either end removed.

```text
app  feature/Login   ->  app-feature-login
app  release/1.2     ->  app-release-1-2
```

The name is the sandbox's Docker Compose project name, and names everything devenv keeps for it (§3.2). The sandbox's primary container is named `<name>-devcontainer`.

### 3.2. Sandbox state

```text
~/.local/state/devenv/<name>/
  state.json                     the sandbox's record (§3.3)
  .devcontainer/devcontainer.json the generated config the sandbox is built from, with its local Features
  override.yaml                  devenv's Compose override (RFC-0006)
~/.local/share/devenv/<name>/
  claude/                        the sandbox's Claude Code data (RFC-0006)
```

Everything under `~/.local/state/devenv/` is devenv's alone: no sandbox mounts it. The generated config and the override are regenerated whenever the sandbox's config is checked, and devenv never reads them back.

### 3.3. SandboxState

The contents of `state.json`.

```typescript
interface SandboxState {
  /** The worktree this sandbox belongs to, exactly as given (not normalized). */
  readonly repo: string;
  readonly branch: string;
  /** Absolute path of the dev container config the worktree last used. */
  readonly sourceConfig?: string;
  /** Identifies everything the existing container was created from; absent until one has been created. */
  readonly createdHash?: string;
  /** How to reach the running sandbox without its config; recorded by a successful `up`. */
  readonly container?: string;
  readonly user?: string;
  readonly workdir?: string;
  /** The sandbox user's home directory, read from the built image (ADR-0008). */
  readonly home?: string;
  /** The config's `remoteEnv`, resolved, for exec'ing into the sandbox. */
  readonly remoteEnv?: Readonly<Record<string, string>>;
}
```

### 3.4. `devenv container up`

```text
devenv container up [<repo> <branch>] [--rebuild] [--config <path>] [--code]
```

- `<repo> <branch>`: the worktree (RFC-0002 §3.1). Given together or not at all.
- `--config <path>`, `--config=<path>`: a `devcontainer.json`, or a folder holding one.
- `--rebuild`, `--code`: switches.

Outputs: stdout `up: <name>`; diagnostics (RFC-0001); writes the sandbox's state (§3.2).

### 3.5. `devenv container down`

```text
devenv container down [<repo> <branch>]
```

- `<repo> <branch>`: the worktree. Given together or not at all.

Outputs: stdout `down: <name>`; diagnostics (RFC-0001).

### 3.6. `devenv container attach`

```text
devenv container attach [<repo> <branch>] [--code]
```

- `<repo> <branch>`: the worktree. Given together or not at all.
- `--code`: a switch.

Outputs: an interactive shell in the sandbox; diagnostics (RFC-0001).

### 3.7. `devenv container list`

```text
devenv container list
```

Outputs: stdout one line per container, `<project>\t<container>\t<status>`; diagnostics (RFC-0001).

## 4. Behavior

### 4.1. Invariants

These requirements apply to every command in §4.3 through §4.7.

#### 4.1.1. Host-only state

devenv SHALL keep every file it generates or records for a sandbox under `~/.local/state/devenv/<name>/` AND SHALL NOT mount that directory into any sandbox.

### 4.2. Resolving a config

#### 4.2.1. Which config

`devenv container up` SHALL build or start the worktree's sandbox from the config resolved as RFC-0003 specifies.

#### 4.2.2. Remembering the config

WHEN `--config` is given, `devenv container up` SHALL record the config's absolute path as the worktree's `sourceConfig` (§3.3), so later runs without `--config`, from any directory, use it too.

### 4.3. Bringing a sandbox up

`devenv container up` is _creating_ the worktree's sandbox while the worktree has no container or `--rebuild` is given, and _starting_ it otherwise.

#### 4.3.1. Name collisions

WHILE another worktree, of any repository, has the same sandbox name (§3.1), `devenv container up` SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST name both worktrees, as `<repo>/<branch>`. It MUST name the sandbox name they share.

> [!NOTE]
> `devenv clone` and `devenv worktree add` already refuse to create such a worktree (RFC-0002 §4.1.2). This catches one created some other way, such as with plain `git worktree add`.

#### 4.3.2. Starting the shared egress stack

WHILE the shared egress stack (RFC-0008) isn't healthy, `devenv container up` SHALL start the stack.

WHILE the shared egress stack is healthy, `devenv container up` SHALL leave the stack as it is AND SHALL NOT recreate it.

> [!NOTE]
> Recreating the shared stack cuts off every other sandbox's proxied connections and pending egress approvals.

#### 4.3.3. Waiting for the shared egress stack

`devenv container up` SHALL wait for the shared egress stack to be healthy before resolving the worktree's config.

#### 4.3.4. Shared egress stack timeout

IF the shared egress stack isn't healthy within 30 seconds of `devenv container up` starting to wait for it, THEN `devenv container up` SHALL fail (RFC-0001 §4.3). Its error message MUST name the stack's containers. It MUST name the command that shows their logs, `docker compose -p devenv-shared logs`.

#### 4.3.5. Sandbox escapes when creating

WHILE `devenv container up` is creating the sandbox and the config contains a sandbox escape (RFC-0004 §3.1), `devenv container up` SHALL fail (RFC-0001 §4.3) before building anything, with the escape report (RFC-0004 §3.2) as its error message.

#### 4.3.6. Missing approval when creating

WHILE `devenv container up` is creating the sandbox and the config's content isn't approved (RFC-0005 §3.1), `devenv container up` SHALL fail (RFC-0001 §4.3) before building anything. Its error message MUST name `devenv container trust <repo> <branch>` as the way to review and approve the config.

#### 4.3.7. Escapes and missing approval when starting

WHILE `devenv container up` is starting the sandbox and the config contains a sandbox escape, `devenv container up` SHALL print each escape as a `warning:` line (RFC-0001 §3.2) AND SHALL start the sandbox.

WHILE `devenv container up` is starting the sandbox and the config's content isn't approved, `devenv container up` SHALL print a `warning:` line (RFC-0001 §3.2) AND SHALL start the sandbox. The warning's message MUST say that the config's content isn't approved.

> [!NOTE]
> Starting an existing sandbox builds nothing from the config, so these findings only take effect once the sandbox is rebuilt (§4.3.10).

#### 4.3.8. Host exposure

WHILE the config exposes host files (RFC-0004 §3.1), `devenv container up` SHALL print a host exposure warning (RFC-0004 §3.2) for each host exposure.

#### 4.3.9. Changes devenv makes to the config

`devenv container up` SHALL print, as a `note:` line (RFC-0001 §3.2), each change devenv makes to the config to keep the sandbox within its limits (RFC-0006).

#### 4.3.10. Rebuilding

WHILE the worktree has a container, WHEN `--rebuild` is given, `devenv container up` SHALL stop all of the worktree's containers before resolving its config AND SHALL then create the sandbox.

> [!NOTE]
> Only the worktree's own containers can write its files, so with them stopped, the config can't change between being checked and being built.

#### 4.3.11. Rebuild failure

`devenv container up` SHALL NOT restart the containers it stopped for `--rebuild`.

> [!NOTE]
> So when creating the sandbox fails, the worktree's containers stay stopped; when it succeeds, the new sandbox's containers replace them.

#### 4.3.12. Learning the sandbox user's home

WHILE `devenv container up` is creating the sandbox, `devenv container up` SHALL build the sandbox's image before generating its mounts, AND SHALL read the home directory of the image's user from a container created from that image but never started, AND SHALL generate the sandbox's mounts under that home ([ADR-0008](../adrs/0008-mirror-the-hosts-paths-in-every-sandbox.md)).

> [!NOTE]
> The mounts are generated before the container exists, but where they go depends on the image's user. Starting a container to find out would run the project's image outside the sandbox's network.

#### 4.3.13. Sandbox inputs

devenv SHALL identify everything a sandbox would be created from by a hash over its generated config, the config's local Features, devenv's own Features, its Compose override (RFC-0006) and the content its approval covers (RFC-0005).

#### 4.3.14. Config drift

WHILE `devenv container up` is starting the sandbox and the sandbox's inputs (§4.3.13) differ from its recorded `createdHash`, `devenv container up` SHALL print a `warning:` line (RFC-0001 §3.2) AND SHALL start the existing container without recreating it. The warning's message MUST name `devenv container up <repo> <branch> --rebuild` as the way to apply the change.

> [!NOTE]
> Recreating a container discards what lives only in it, such as running background agents, so a changed config is reported rather than applied.

#### 4.3.15. Build or start failure

IF the devcontainer CLI fails to build or start the sandbox, THEN `devenv container up` SHALL fail (RFC-0001 §4.3). Its error message MUST include the CLI's own error message.

#### 4.3.16. Recording how to reach the sandbox

`devenv container up` SHALL record in the sandbox's state (§3.3) the worktree's `repo` and `branch`, and the `container`, `user`, `workdir`, `home` and resolved `remoteEnv` needed to reach the sandbox, once the devcontainer CLI has brought the sandbox up.

#### 4.3.17. Recording what the sandbox was created from

WHILE `devenv container up` is creating the sandbox, `devenv container up` SHALL record the sandbox's inputs (§4.3.13) as its `createdHash` only once the devcontainer CLI has created the container, so the drift warning (§4.3.14) still applies to any container that's left when creating it fails.

#### 4.3.18. Success

`devenv container up` SHALL print `up: <name>` on stdout after recording the sandbox's state (§4.3.16).

#### 4.3.19. Opening an editor

WHEN `--code` is given, `devenv container up` SHALL, as its last step, open VS Code attached to the sandbox, as `devenv container attach --code` does (§4.5.5).

### 4.4. Taking a sandbox down

#### 4.4.1. Removing the stack

WHILE the worktree has containers, `devenv container down` SHALL remove the worktree's containers and networks AND SHALL keep its state and Claude Code data (§3.2).

#### 4.4.2. Nothing to take down

WHILE the worktree has no containers, `devenv container down` SHALL change nothing AND SHALL succeed.

#### 4.4.3. Stopping the shared egress stack

WHILE the worktree has containers and no other worktree's container is on the shared egress stack's network, `devenv container down` SHALL stop the shared stack (RFC-0008) after removing the worktree's containers. `devenv container down` MUST tell from Docker's current state whether any container is left, not from a count devenv keeps.

#### 4.4.4. Success

`devenv container down` SHALL print `down: <name>` on stdout as its last step.

### 4.5. Opening a shell

`devenv container attach` only enters a running sandbox, working from the sandbox's recorded state alone, so it works whatever state the worktree's config is in.

#### 4.5.1. The shell

WHILE the sandbox is running, WHEN `--code` is omitted, `devenv container attach` SHALL start an interactive login shell in the sandbox's primary container AND SHALL run it as the recorded `user`, in the recorded `workdir`, with the recorded `remoteEnv`. The shell MUST be the user's login shell as the container's user database records it, or `sh` when none is recorded.

#### 4.5.2. No side effects

`devenv container attach` SHALL NOT read the worktree's config, run its checks, or change any of the sandbox's state.

#### 4.5.3. Not running

WHILE the sandbox isn't running, `devenv container attach` SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST name `devenv container up <repo> <branch>` as the way to start the sandbox.

#### 4.5.4. No recorded state

WHILE any of `container`, `user` and `workdir` is missing from the sandbox's state, `devenv container attach` SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST name `devenv container up <repo> <branch>` as the way to record them.

#### 4.5.5. Opening an editor

WHILE the sandbox is running, WHEN `--code` is given, `devenv container attach` SHALL open VS Code attached to the sandbox's primary container, in the recorded `workdir`, instead of starting a shell. `devenv container attach` MUST address the container with a `vscode-remote://attached-container+<container>` folder URI AND MUST NOT use a `dev-container+…` URI or any folder that VS Code would resolve to the worktree's dev container config.

> [!NOTE]
> VS Code has two ways to open a container. A dev container URI points at a project folder, and VS Code then reads that folder's `devcontainer.json`, may offer to rebuild or reopen in a container, and runs the config's own lifecycle. An attached-container URI points at a running container by name and never looks at the config. The worktree's dev container config is agent-writable and untrusted until approved (ADR-0005), so only the attached form keeps `attach` from reading it (§4.5.2) and working while it is broken (§5.3).

#### 4.5.6. No `code` command

WHILE the `code` command isn't on the `PATH`, WHEN `--code` is given, `devenv container attach` SHALL fail (RFC-0001 §4.3) without opening anything. Its error message MUST name VS Code's "Shell Command: Install 'code' command in PATH" as the way to install it.

WHILE the `code` command isn't on the `PATH`, WHEN `--code` is given, `devenv container up` SHALL fail (RFC-0001 §4.3) without opening anything AND SHALL leave the sandbox up. Its error message MUST name VS Code's "Shell Command: Install 'code' command in PATH" as the way to install it.

### 4.6. Listing sandboxes

#### 4.6.1. Every container

`devenv container list` SHALL print one line per container, `<project>\t<container>\t<status>`, for every container of the shared egress stack and of every worktree's sandbox, whether running or not.

#### 4.6.2. Order

`devenv container list` SHALL print the shared egress stack's containers first, then the sandboxes' containers, sorted by project and then by container name.

### 4.7. Choosing a worktree

Every lifecycle command except `list` resolves its worktree as RFC-0002 §4.4 specifies.

#### 4.7.1. `up`

`devenv container up` SHALL resolve its worktree as RFC-0002 §4.4 specifies.

#### 4.7.2. `down` and `attach`

`devenv container down` SHALL resolve its worktree as RFC-0002 §4.4 specifies, with the eligible worktrees limited to those whose sandbox is running.

`devenv container attach` SHALL resolve its worktree as RFC-0002 §4.4 specifies, with the eligible worktrees limited to those whose sandbox is running.

#### 4.7.3. Nothing running to pick

WHILE no sandbox is running, WHEN `<repo>` and `<branch>` are omitted, `devenv container down` SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST say that no sandbox is running.

WHILE no sandbox is running, WHEN `<repo>` and `<branch>` are omitted, `devenv container attach` SHALL fail (RFC-0001 §4.3) without changing anything. Its error message MUST say that no sandbox is running.

## 5. Examples

### 5.1. Creating a sandbox from an unapproved config

Setup: `worktrees/app/main` has a `.devcontainer/devcontainer.json` that has never been approved, and no sandbox.

Call: `devenv container up app main`

Result: exit status `1`, nothing built, and on stderr:

```text
error: the dev container config app:.devcontainer/devcontainer.json hasn't been approved in this form (new, or changed since last approved); review it with: devenv container trust app main
```

### 5.2. Starting a sandbox whose config changed

Setup: `app/main`'s sandbox exists, and since it was created its config has changed and the change has been approved.

Call: `devenv container up app main`

Result: the existing container starts, unchanged. On stderr:

```text
warning: config changed since this container was created; run 'devenv container up app main --rebuild' (or down/up) to apply it
```

### 5.3. Attaching while the config is broken

Setup: `app/main`'s sandbox is running, and an agent has left `.devcontainer/devcontainer.json` unparseable.

Call: `devenv container attach app main`

Result: a login shell in the sandbox, as its recorded user, in `~/devenv/worktrees/app/main`. The config isn't read.

## 6. Out of scope

- What a sandbox contains: devenv's Compose override, its mounts and networks, and the Claude Code data it seeds. Specified in RFC-0006.
- The rules a config is checked against, and approval itself. Specified in RFC-0004 and RFC-0005.
- The shared egress stack itself: what it runs and how it filters traffic. Specified in RFC-0008.
- Background agents. Specified in RFC-0010.
- Resolving sandbox name collisions [future]. They're only detected (§4.3.1, RFC-0002 §4.1.2). If resolving them ever matters, a name could be assigned once, with a short hash added only on collision, and recorded in the sandbox's state; the state directory would then need a key that can't collide.
- Configs that aren't Compose-based ([ADR-0004](../adrs/0004-define-sandboxes-with-standard-dev-container-configs.md)).
