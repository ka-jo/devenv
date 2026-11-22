---
rfc: 0006
title: The sandbox layer
status: Draft
see_also:
  - ADR-0001
  - ADR-0002
  - ADR-0004
  - ADR-0007
  - ADR-0008
  - RFC-0001
  - RFC-0007
  - RFC-0004
  - RFC-0008
---

# RFC 0006: The sandbox layer

## 1. Summary

This RFC specifies what devenv puts on top of a worktree's dev container config to make it a sandbox: the Compose override that gives the config's primary service its network, environment and mounts and keeps the rest of the project inside the sandbox, the config devenv generates for the devcontainer CLI to run, the `agent` Feature installed into every sandbox image, and the Claude Code data devenv seeds for each sandbox. It doesn't specify when these are generated, which is part of the sandbox lifecycle (RFC-0007).

## 2. Motivation

A sandbox is defined by a dev container config, and devenv applies what it requires of every sandbox on top of whichever config is used, never requiring it to be written into the config ([ADR-0004](../adrs/0004-define-sandboxes-with-standard-dev-container-configs.md)). What it requires is a sandbox whose limits the agent can't change from inside ([ADR-0001](../adrs/0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)), in which agents act without stopping for approval ([ADR-0002](../adrs/0002-let-agents-act-without-per-action-approval-inside-their-sandbox.md)), one per worktree, running side by side with the others ([ADR-0007](../adrs/0007-give-each-worktree-one-sandbox-shared-by-every-agent-working-in-it.md)), and mirroring the host's paths ([ADR-0008](../adrs/0008-mirror-the-hosts-paths-in-every-sandbox.md)). This RFC specifies the layer that carries those requirements into every sandbox.

Prior to this RFC, the layer differed from what is specified here:

- `NO_PROXY` listed only `localhost` and `127.0.0.1`, so HTTP requests from the primary service to the project's own services went to the egress proxy, which can't reach them (§4.2.2.5).
- Only Node had a runtime-specific proxy setting; Java ignored the proxy (§4.2.2.6).
- Managed settings were installed by the `agent` Feature as a symlink, which a Feature installed after it could replace (§4.2.2.14, §4.4.6).
- `claude` went through devenv's wrapper only in interactive zsh and bash sessions, through an alias, so Claude Code started any other way, from an editor for example, ran without it (§4.4.5).
- Every other repository's bare clone was mounted read-only into every sandbox (§4.2.2.12).
- The `agent` Feature continued on an image without `apt-get` whenever `curl` was present, without installing what Claude Code needs (§4.4.2).

## 3. Interface

### 3.1. Terms

- **The config**: the dev container config the sandbox is built from, resolved as RFC-0003 specifies, and its Compose files.
- **The primary service**: the Compose service the config names as its dev container (`service`). Agents run in its container.
- **A sidecar**: any other service in the config's Compose model.
- **The project**: every service and network in the config's Compose model, the primary service included.
- **A project network**: a network that some service in the config's Compose model is connected to, including Compose's implicit `default` network, other than one declared `external`.
- **A mirrored path**: a path under the sandbox user's home that is the same, relative to that home, as a path on the host is relative to the host user's home ([ADR-0008](../adrs/0008-mirror-the-hosts-paths-in-every-sandbox.md)).

### 3.2. The Compose override

The sandbox's `override.yaml` (RFC-0007 §3.2), the last Compose file the sandbox is built from, so its settings win over the config's. Its content is a `ComposeOverride`, written as Compose YAML, with `COMPOSE_RESET` rendered as Compose's `!reset null`, which drops the setting from the merged result.

```typescript
// Compose's own format, not defined by devenv: these are the keys of a Compose file
// (https://github.com/compose-spec/compose-go/blob/main/schema/compose-spec.json), narrowed to the ones the
// override sets, which is why they're snake_case.
interface ComposeOverride {
  /** The sandbox's name (RFC-0007 §3.1), used as the Compose project name. */
  readonly name: string;
  /** Per-service settings, merged over each service's own. */
  readonly services: Readonly<Record<string, ComposeServiceOverride>>;
  /** Per-network settings, merged over each network's own. */
  readonly networks: Readonly<Record<string, ComposeNetworkOverride>>;
}

interface ComposeServiceOverride {
  readonly container_name?: string | ComposeReset;
  readonly working_dir?: string;
  /** Network keys, added to the service's own. */
  readonly networks?: readonly string[];
  /** Environment variables, merged over the service's own. */
  readonly environment?: Readonly<Record<string, string>>;
  /** Mounts, merged over the service's own by target. */
  readonly volumes?: readonly ComposeMount[];
  readonly ports?: ComposeReset;
}

type ComposeMount =
  | { readonly type: "bind"; readonly source: string; readonly target: string; readonly read_only: boolean }
  | { readonly type: "tmpfs"; readonly target: string; readonly read_only: boolean };

type ComposeNetworkOverride =
  /** The shared egress stack's proxy network. */
  | { readonly external: true; readonly name: string }
  /** A project network. */
  | {
      readonly internal: true;
      readonly driver_opts: Readonly<Record<string, string>>;
      readonly ipam?: ComposeReset;
    };

type ComposeReset = typeof COMPOSE_RESET;
```

### 3.3. The generated config

The sandbox's generated `devcontainer.json` (RFC-0007 §3.2), which the devcontainer CLI builds and runs the sandbox from. Its content is a `GeneratedConfig`: the config as written, with the fields below set by devenv. Its fields are the Development Container Specification's own.

```typescript
interface GeneratedConfig {
  /** The config's Compose files as absolute paths, in order, then the sandbox's override. */
  readonly dockerComposeFile: readonly string[];
  /** The config's primary service. */
  readonly service: string;
  /** The worktree's mirrored path. */
  readonly workspaceFolder: string;
  /** The config's Features, plus the `agent` Feature. */
  readonly features: Readonly<Record<string, unknown>>;
  readonly updateRemoteUserUID: boolean;
  /** Every other field of the config as written, except `initializeCommand`. */
  readonly [key: string]: unknown;
}
```

### 3.4. The `agent` Feature

A local Feature, `devcontainer/features/agent`, with this metadata:

```json
{
  "id": "agent",
  "postStartCommand": "devenv link",
  "installsAfter": ["ghcr.io/devcontainers/features/common-utils"]
}
```

What it leaves in the image:

```text
/etc/devenv/home            the sandbox user's home directory
/usr/local/bin/devenv       -> ~/devenv/bin/devenv (resolves once ~/devenv is mounted)
claude on the user's PATH   devenv's wrapper around Claude Code (RFC-0008)
```

### 3.5. SeededClaudeJson

The `.claude.json` devenv writes into a sandbox's Claude Code data (RFC-0007 §3.2).

```typescript
interface SeededClaudeJson {
  readonly hasCompletedOnboarding: true;
  /** Keyed by the worktree's mirrored path. */
  readonly projects: Readonly<Record<string, { readonly hasTrustDialogAccepted: true }>>;
}
```

## 4. Behavior

devenv makes a worktree's config into a sandbox with four artifacts. The Compose override (§4.2) keeps the whole project inside the sandbox and gives the primary service, where agents run, its only route out and its mounts. The generated config (§4.3) is what the devcontainer CLI builds and runs the sandbox from, with the override and the `agent` Feature added to the config. The `agent` Feature (§4.4) equips the sandbox's image for agents, and devenv seeds each sandbox's Claude Code data (§4.5).

### 4.1. Invariants

These requirements apply to §4.2 and §4.3.

#### 4.1.1. The config is left alone

`devenv container up` SHALL NOT modify any of the config's files. The changes described in §4.2 and §4.3 live only in the Compose override and the generated config.

#### 4.1.2. Reported changes

The Compose override and the generated config SHALL each come with one notice per change devenv makes to what the config asks for, which `devenv container up` prints as a `note:` message (RFC-0001 §3.2, RFC-0007 §4.3.9). Each notice MUST name the service or network changed, or the config field, and what was changed.

### 4.2. The Compose override

The Compose override's settings fall into two groups: those that apply across the whole project, the primary service included, and those only the primary service gets.

#### 4.2.1. Settings for the whole project

What keeps the whole project inside the sandbox and lets several worktrees of it run at once.

##### 4.2.1.1. Project name

The Compose override SHALL set the project's `name` to the sandbox's name (RFC-0007 §3.1).

##### 4.2.1.2. Published ports

WHILE a service publishes ports, the Compose override SHALL reset that service's `ports`.

> [!NOTE]
> Docker doesn't publish ports on internal networks anyway; resetting them keeps that true even if a service ever got another network, where a port published on `0.0.0.0` would reach the whole local network.

##### 4.2.1.3. Container names

WHILE a sidecar sets a `container_name`, the Compose override SHALL reset it.

> [!NOTE]
> A fixed name collides as soon as a second worktree of the project runs ([ADR-0007](../adrs/0007-give-each-worktree-one-sandbox-shared-by-every-agent-working-in-it.md)). With it reset, Compose names the container `<project>-<service>-<n>`, unique to the sandbox, and the project's other services still reach it by its service name, which resolves only on the sandbox's own project networks.

##### 4.2.1.4. Project networks

The Compose override SHALL declare every project network `internal` AND SHALL set `com.docker.network.bridge.inhibit_ipv4` on every project network.

> [!NOTE]
> `internal` gives containers on the network no route out. `inhibit_ipv4` gives the host no address on the network. The second is needed because `internal` alone doesn't isolate the host: Docker still gives the host an address on an internal network, and a container can use it to reach any service the host listens on at `0.0.0.0`, bypassing the egress proxy.

##### 4.2.1.5. Fixed subnets

WHILE a project network sets a fixed subnet, the Compose override SHALL reset its `ipam`.

> [!NOTE]
> A fixed subnet collides as soon as a second worktree of the project runs.

##### 4.2.1.6. The worktree mounted elsewhere

WHILE a service bind-mounts the worktree at a path of its own, the Compose override SHALL mount the worktree's `.git` file read-only at `<path>/.git` in that service.

> [!NOTE]
> The `.git` file names the worktree's administrative directory, and host-side git trusts it. A config MAY mount the worktree at a path of its own as well as at its mirrored path ([ADR-0008](../adrs/0008-mirror-the-hosts-paths-in-every-sandbox.md)).

#### 4.2.2. Settings for the primary service

What makes the primary service's container the place agents run: its name, its only route out, and its mounts.

##### 4.2.2.1. Container name

The Compose override SHALL set the primary service's `container_name` to `<name>-devcontainer`, where `<name>` is the sandbox's name (RFC-0007 §3.1), replacing any `container_name` the config sets.

##### 4.2.2.2. Working directory

The Compose override SHALL set the primary service's `working_dir` to the worktree's mirrored path.

##### 4.2.2.3. Networks

The Compose override SHALL list in the primary service's `networks` the shared egress stack's proxy network, declared `external` under its fixed name (RFC-0008), AND SHALL list every project network the config connects the primary service to, other than `default`.

WHILE the config connects the primary service and at least one sidecar to `default`, the Compose override SHALL list `default` in the primary service's `networks`.

WHILE no sidecar is connected to `default`, the Compose override SHALL NOT list `default` in the primary service's `networks`.

> [!NOTE]
> Compose connects a service that lists no `networks` to `default` on its own, but stops as soon as the service has a `networks` list, which the override always gives the primary service. So the override lists every network the primary service stays connected to, `default` included. The proxy network is the primary service's only way out; its project networks reach only the project's sidecars (§4.2.1.4), and a `default` network no sidecar is connected to would reach nothing.

##### 4.2.2.4. Proxy environment

The Compose override SHALL set `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy` and `https_proxy` on the primary service to `http://firewall:3128`, the egress proxy's address on the proxy network (RFC-0008).

##### 4.2.2.5. Proxy exemptions

The Compose override SHALL set `NO_PROXY` and `no_proxy` on the primary service to `localhost`, `127.0.0.1`, and the name of every service in the config's Compose model, separated by commas.

> [!NOTE]
> The egress proxy isn't on the project's networks, so a request for one of the project's own services sent through it can't arrive.

##### 4.2.2.6. Runtimes that ignore the proxy variables

The Compose override SHALL set, on the primary service, the variables in the table below, so each runtime's standard HTTP client uses the egress proxy and the exemptions of §4.2.2.5. Runtimes not listed are expected to honor the variables of §4.2.2.4 and §4.2.2.5 on their own.

| Runtime | Variable | Value |
|---|---|---|
| Node | `NODE_USE_ENV_PROXY` | `1` |
| Java | `JAVA_TOOL_OPTIONS` | `-Dhttp.proxyHost=firewall -Dhttp.proxyPort=3128 -Dhttps.proxyHost=firewall -Dhttps.proxyPort=3128 -Dhttp.nonProxyHosts=<exemptions>`, where `<exemptions>` is §4.2.2.5's list separated by `\|` |

> [!NOTE]
> Bun's `fetch` and .NET's `HttpClient` on Linux read the variables of §4.2.2.4 and §4.2.2.5 themselves, so they need no entry. A tool that honors none of these can't reach the network at all: the proxy network is the only route out.

##### 4.2.2.7. Claude Code's config directory

The Compose override SHALL set `CLAUDE_CONFIG_DIR` on the primary service to `~/.claude` under the sandbox user's home ([ADR-0008](../adrs/0008-mirror-the-hosts-paths-in-every-sandbox.md)).

##### 4.2.2.8. The devenv repo

The Compose override SHALL mount the devenv repo read-only at `~/devenv` under the sandbox user's home ([ADR-0008](../adrs/0008-mirror-the-hosts-paths-in-every-sandbox.md)).

> [!NOTE]
> Read-only because the repo holds the egress allowlist and devenv's own config, which have to stay out of the agent's reach ([ADR-0001](../adrs/0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)).

##### 4.2.2.9. The worktree

The Compose override SHALL mount the worktree read-write at its mirrored path AND SHALL mount the worktree's `.git` file read-only over it.

##### 4.2.2.10. The bare clone

The Compose override SHALL mount the worktree's bare clone read-write at its mirrored path, AND SHALL mount read-only over it the clone's `config`, `hooks/`, `worktrees/` and every submodule's git directory under `modules/`, AND SHALL mount the worktree's own administrative directory, `worktrees/<name>`, read-write over that, with its `commondir` read-only.

> [!NOTE]
> These are the files host-side git reads its configuration and hooks from. Writable, a process in the sandbox could set `core.hooksPath` or `core.fsmonitor`, or point the worktree at a config it controls, and have code run on the host the next time git runs there. devenv creates the clone's `hooks/` when it's missing, since a mount needs a source.

##### 4.2.2.11. Other checkouts hidden

The Compose override SHALL mount an empty, read-only tmpfs at `~/devenv/worktrees` in the primary service, so that only the mounts of §4.2.2.9 and §4.2.2.10 show through it.

> [!NOTE]
> Without it, the read-only repo mount would expose every repository's worktrees, with their uncommitted work and ignored files such as `.env`.

##### 4.2.2.12. Other repositories

The Compose override SHALL NOT mount any other repository's bare clone or worktrees into any service.

##### 4.2.2.13. Claude Code data

The Compose override SHALL mount the sandbox's own Claude Code data directory (RFC-0007 §3.2) read-write at `~/.claude` under the sandbox user's home.

##### 4.2.2.14. What comes from the host's Claude Code config

The Compose override SHALL mount the host's `~/.claude/.credentials.json` read-write and `~/.claude/settings.json` read-only into the sandbox's `~/.claude` AND SHALL mount devenv's `devcontainer/managed-settings.json` read-only at `/etc/claude-code/managed-settings.json`. It MUST NOT mount anything else from the host's Claude Code config, nor the host's `~/.claude.json`.

> [!NOTE]
> The rest of the host's Claude Code config steers the host's Claude Code: settings hooks and MCP servers are commands it runs, and skills, rules and instructions are what it follows. Any of it writable from a sandbox would be a way out of it. The credentials are writable so Claude Code can refresh its token.

### 4.3. The generated config

#### 4.3.1. Compose files

The generated config SHALL list the config's Compose files as absolute paths, in the config's order, AND SHALL list the sandbox's Compose override after them.

#### 4.3.2. Workspace folder

The generated config SHALL set `workspaceFolder` to the worktree's mirrored path.

#### 4.3.3. Host commands

The generated config SHALL NOT include the config's `initializeCommand`.

> [!NOTE]
> The devcontainer CLI runs `initializeCommand` on the host, outside every sandbox.

#### 4.3.4. The `agent` Feature

The generated config SHALL add the `agent` Feature (§3.4) to the config's Features.

#### 4.3.5. The user's UID

WHILE the config doesn't set `updateRemoteUserUID`, the generated config SHALL set it to `true`.

> [!NOTE]
> An image's user rarely has the host user's UID, which every read-write bind mount needs. A config that sets `updateRemoteUserUID` knows its own user.

#### 4.3.6. Local Features

The generated config's folder SHALL hold a copy of each of the config's local Features (a `./<path>` key in `features`), at the same relative path as beside the config, AND SHALL NOT hold a link to any of them.

> [!NOTE]
> The devcontainer CLI only accepts local Features under the generated config's folder. A link would point back into the agent-writable worktree, which the build runs as root. devenv's own Features come from the read-only devenv repo, so they MAY be linked.

#### 4.3.7. Everything else

The generated config SHALL keep every other field of the config as written.

### 4.4. The `agent` Feature

The `agent` Feature's install script runs as root while the sandbox's image is built.

#### 4.4.1. Git version

WHILE the image's git is older than 2.48, or the image has no git, the `agent` Feature SHALL fail the build. Its error MUST name the git version required and `ghcr.io/devcontainers/features/git` as a way to install one.

> [!NOTE]
> devenv creates worktrees with relative links (RFC-0002 §4.1.1), which older git refuses to open.

#### 4.4.2. Base image

WHILE the image has no `apt-get`, the `agent` Feature SHALL fail the build. Its error MUST say that only apt-based images are supported.

WHILE the image has `apt-get`, the `agent` Feature SHALL install `curl`, `ca-certificates` and `libatomic1`.

#### 4.4.3. Claude Code

The `agent` Feature SHALL install Claude Code for the sandbox user with Claude Code's native installer.

#### 4.4.4. The user's home

The `agent` Feature SHALL write the sandbox user's home directory, as the image's user database records it, to `/etc/devenv/home`.

> [!NOTE]
> devenv reads this file from the built image to know where to mount `~/devenv` and `~/.claude` (RFC-0007 §4.3.12).

#### 4.4.5. Claude Code through devenv's wrapper

The `agent` Feature SHALL make `claude`, as found on the sandbox user's `PATH` by any process, interactive or not, run devenv's wrapper (RFC-0008), which then runs Claude Code.

#### 4.4.6. Managed settings

The `agent` Feature SHALL NOT install managed settings. They're mounted by the Compose override (§4.2.2.14), so nothing installed while the image is built can replace them.

#### 4.4.7. The devenv command

The `agent` Feature SHALL link `/usr/local/bin/devenv` to `~/devenv/bin/devenv` under the sandbox user's home.

#### 4.4.8. Linking devenv's Claude Code config

The `agent` Feature SHALL run `devenv link` every time the sandbox starts (`postStartCommand`), so devenv's Claude Code config is linked into the sandbox's `~/.claude` from the read-only repo mount.

### 4.5. Claude Code data

`devenv container up` seeds a sandbox's Claude Code data (RFC-0007 §3.2) before the sandbox starts.

#### 4.5.1. Seeding

WHILE the sandbox's Claude Code data has no `.claude.json`, `devenv container up` SHALL write one (§3.5) with onboarding completed and the worktree's mirrored path trusted.

> [!NOTE]
> The sandbox, not Claude Code's trust prompt, is what contains agents ([ADR-0002](../adrs/0002-let-agents-act-without-per-action-approval-inside-their-sandbox.md)), and the prompt would stop a background agent that nobody is watching.

#### 4.5.2. Afterwards

WHILE the sandbox's Claude Code data has a `.claude.json`, `devenv container up` SHALL NOT read or change it.

> [!NOTE]
> Once written, the file is Claude Code's, and writable from the sandbox.

## 5. Examples

### 5.1. A project with a database

Setup: the config's primary service `app` publishes port `3000`; a sidecar `db` sets `container_name: db` and is on the project network `backend` with a fixed subnet; the sandbox is named `shop-main`.

Result: the Compose override

- names `app`'s container `shop-main-devcontainer`, puts it on the proxy network and `backend`, and sets `NO_PROXY=localhost,127.0.0.1,app,db`;
- resets `app`'s `ports` and `db`'s `container_name`;
- declares `backend` internal with no host-side address, and resets its subnet.

`devenv container up` prints:

```text
note: service app: published ports removed (containers are on internal networks only)
note: service db: container_name removed (it would collide across worktrees)
note: network backend: fixed subnet removed (it would collide across worktrees)
```

## 6. Out of scope

- When the layer is generated, and what happens to the sandbox when its inputs change. Specified in RFC-0007.
- What the config may and may not ask for. Specified in RFC-0004.
- The egress proxy, the shared egress stack, and devenv's wrapper around Claude Code. Specified in RFC-0008.
- Configs that aren't Compose-based ([ADR-0004](../adrs/0004-define-sandboxes-with-standard-dev-container-configs.md)).
- Images without `apt-get` [future]. §4.4.2 is where support for other package managers would go.
- Transparent proxying [future]. If the egress design moves to it, the variables of §4.2.2.4 through §4.2.2.6 would no longer be needed.
- Other runtimes in §4.2.2.6's table [future]. A runtime is added by adding a row.

## 7. Open questions

- `JAVA_TOOL_OPTIONS` (§4.2.2.6) replaces any value the config sets for the primary service. Should devenv append its options to the config's instead?
- A config can connect one service to another by the other's `container_name` rather than its service name, which stops resolving once §4.2.1.3 or §4.2.2.1 replaces it. Should the Compose override keep each replaced name resolvable, as a network alias on the service's project networks?
- Every sandbox's primary service is connected to the same shared proxy network (§4.2.2.3). Can sandboxes reach each other over it, and should they be able to?
