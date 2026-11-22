---
rfc: 0004
title: Config validation
status: Draft
see_also:
  - ADR-0001
  - ADR-0004
  - ADR-0005
  - RFC-0002
  - RFC-0003
  - RFC-0005
  - RFC-0006
  - RFC-0007
  - docs/agent-container-security.md
---

# RFC 0004: Config validation

## 1. Summary

This RFC specifies config validation, and introduces `devenv container validate`, the command that runs it on its own: the rules a worktree's dev container config is checked against, which findings are sandbox escapes and which only expose host files, the order in which the config and what its Features and base image add are checked, and how findings are reported. `devenv container validate` runs config validation on its own. Approving a config (RFC-0005) and building a sandbox from one (RFC-0007) build on it.

## 2. Motivation

Agents run in a sandbox whose limits are enforced from outside it ([ADR-0001](../adrs/0001-run-agents-in-a-sandbox-that-limits-what-they-can-reach.md)), and a sandbox is defined by a dev container config that devenv applies its own limits on top of ([ADR-0004](../adrs/0004-define-sandboxes-with-standard-dev-container-configs.md)). A config can still ask for things that would take those limits apart, such as host privileges, host namespaces, a container runtime socket, or a network route around the egress proxy. Config validation finds them before anything is built. A config that would take its sandbox apart is rejected whether or not it has been approved, while exposing host files is left to the person approving the config ([ADR-0005](../adrs/0005-approve-every-dev-container-configs-exact-content-before-building-from-it.md)).

Config validation is what every later step builds on. `devenv container trust` runs it before showing a config for approval (RFC-0005), and `devenv container up` runs it before building a sandbox (RFC-0007). Those RFCs specify what each command does with the findings, in terms of the conditions §3.1 defines. `devenv container validate` runs the same validation on its own, so a config can be validated before it's approved or built, by a person or in CI.

This RFC and [`docs/agent-container-security.md`](../agent-container-security.md) complement each other. The document explains each rule to someone whose config was rejected or warned about, in a section named by the rule, and points back here; this RFC specifies exactly what each rule checks.

Prior to this RFC, devenv had no command that validated a config without approving it or building from it (§3.4).

## 3. Interface

### 3.1. Findings

Config validation reports each rule a config breaks, in each place it breaks it, as one finding:

```typescript
interface Violation {
  /** The rule; also the name of its section in docs/agent-container-security.md. */
  readonly rule: ViolationRule;
  /** Where it was found: `service <name>`, `network <name>`, `volume <name>`, `secret <name>`, `config <name>`,
   *  `dev container config`, `Features / base image metadata`, a compose file's path, or the config's folder. */
  readonly location: string;
  /** What was found. */
  readonly detail: string;
}

type ViolationRule =
  | "privileged"         // §4.2.2.1, §4.2.4.1
  | "host-namespaces"    // §4.2.2.2
  | "network-mode"       // §4.2.2.3
  | "capabilities"       // §4.2.2.4, §4.2.4.2
  | "security-opt"       // §4.2.2.5, §4.2.4.3
  | "devices"            // §4.2.2.6
  | "host-paths"         // §4.2.1.4
  | "docker-socket"      // §4.2.1.3
  | "volume-driver-opts" // §4.2.3.3
  | "external-networks"  // §4.2.3.2
  | "build-network"      // §4.2.2.9
  | "compose-includes"   // §4.2.5
  | "config-folder";     // §4.2.6
```

Each finding is one of two kinds (§4.2.1.2): a **sandbox escape**, which no approval can accept, or **host exposure**, which only makes host files visible inside the sandbox. Other RFCs use two conditions this RFC defines:

- **The config contains a sandbox escape**: config validation reports at least one sandbox escape for it.
- **The config exposes host files**: config validation reports at least one host exposure for it.

### 3.2. Reports

The **escape report** lists a config's sandbox escapes:

```text
the dev container config breaks devenv's sandbox rules:
  - <location>: <detail> [<rule>]
  …
  (what its Features and base image add is checked once these are fixed)
  see docs/agent-container-security.md (sections named by the [rule]), or pick another config with --config <path>
```

Its third line appears only when what the config's Features and base image add wasn't checked (§4.3.2). A command that fails because of escapes uses the escape report as its error message, so its first line follows `error: `.

A **host exposure warning** reports one host exposure, as a `warning:` message (RFC-0001 §3.2):

```text
warning: <location>: <detail> [<rule>]
```

### 3.3. What config validation reads

- **The config** and **the config's folder**, as RFC-0003 §3.2 defines them. Config validation also reads the config's Compose files.
- **The allowed roots**: the worktree and the config's folder. Host paths inside them raise no `host-paths` finding.
- **The primary service**: the Compose service the config names as its dev container (`service`). 
- **A sidecar**: any other service in the config's Compose model.
- **The merged config**: the config together with what its Features and its base image's `devcontainer.metadata` label add, as the devcontainer CLI resolves it.

The config's Compose files are read as Compose normalizes them:

```typescript
// Copied from the output of Docker's CLI, not defined by devenv: Compose owns this format
// (https://github.com/compose-spec/compose-go/blob/main/schema/compose-spec.json). These interfaces narrow it to the
// fields config validation reads. Its shape is trusted as-is because Compose has already normalized it.
interface ComposeModel {
  readonly services: Readonly<Record<string, ComposeService>>;
  readonly networks?: Readonly<Record<string, { readonly external?: boolean }>> | null;
  readonly volumes?: Readonly<Record<string, { readonly driver_opts?: Readonly<Record<string, string>> | null }>> | null;
  readonly secrets?: Readonly<Record<string, { readonly file?: string }>> | null;
  readonly configs?: Readonly<Record<string, { readonly file?: string }>> | null;
}

interface ComposeService {
  readonly build?: { readonly context?: string; readonly dockerfile?: string; readonly network?: string } | null;
  readonly volumes?: readonly { readonly type: string; readonly source?: string; readonly target: string }[] | null;
  readonly env_file?: readonly { readonly path: string }[] | null;
  readonly network_mode?: string | null;
  readonly privileged?: boolean | null;
  readonly cap_add?: readonly string[] | null;
  readonly security_opt?: readonly string[] | null;
  readonly devices?: readonly unknown[] | null;
  readonly pid?: string | null;
  readonly ipc?: string | null;
  readonly uts?: string | null;
  readonly userns_mode?: string | null;
  readonly cgroup?: string | null;
}
```

The config itself, and the merged config, are read as the devcontainer CLI's `read-configuration` returns them:

```typescript
// Copied from the output of the devcontainer CLI, not defined by devenv: the Development Container Specification owns
// this format (https://containers.dev/implementors/json_reference/). Only the fields config validation reads are named.
// Their values are `unknown` because this output isn't normalized (`mounts` mixes strings and objects, for one), so
// each is type-checked where it's read (§4.2.4).
interface DevcontainerConfig {
  readonly privileged?: unknown;
  readonly capAdd?: unknown;
  readonly securityOpt?: unknown;
  readonly mounts?: unknown;
  readonly [key: string]: unknown;
}
```

### 3.4. `devenv container validate`

```text
devenv container validate [<repo> <branch>] [--config <path>]
```

- `<repo> <branch>`: the worktree (RFC-0002 §3.1). Given together or not at all.
- `--config <path>`, `--config=<path>`: a `devcontainer.json`, or a folder holding one.

Outputs: stdout `valid: <config>`, where `<config>` is the config's absolute path, when the config contains no sandbox escape; the escape report or host exposure warnings (§3.2) and other diagnostics (RFC-0001) on stderr.

## 4. Behavior

### 4.1. Invariants

These requirements apply wherever config validation runs, whichever command runs it.

#### 4.1.1. Nothing is built without validation

devenv SHALL NOT build or create a sandbox from a config unless config validation has validated that config, in its current content, earlier in the same command, AND the config contains no sandbox escape.

> [!NOTE]
> This holds for every command that builds sandboxes, today `devenv container up` and `devenv agent up` (RFC-0007), and for any added later. It's the RFC-level form of [ADR-0005](../adrs/0005-approve-every-dev-container-configs-exact-content-before-building-from-it.md)'s rule that an escape blocks a config whether or not it's approved.

#### 4.1.2. Config validation has no side effects

Config validation SHALL NOT build or start anything, AND SHALL NOT create, change or record anything about a sandbox, AND SHALL NOT change any approval.

> [!NOTE]
> None of these rules out pulling images: resolving the merged config can pull the config's base image into Docker's image store (§4.3).

### 4.2. The rules

What config validation checks the config against. Every rule applies wherever config validation runs, whichever command runs it.

#### 4.2.1. Invariants

These requirements apply to every rule in §4.2.2 through §4.2.6.

##### 4.2.1.1. Every finding is reported

Config validation SHALL report one violation for each rule a config breaks in each place it breaks it, AND SHALL NOT stop at the first. It MUST report them in the same order every time it checks the same config.

##### 4.2.1.2. Escape or exposure

Config validation SHALL classify every `host-paths`, `volume-driver-opts` and `config-folder` violation as host exposure, AND SHALL classify every other violation as a sandbox escape.

> [!NOTE]
> The three exposure rules only make host files visible inside the sandbox, which the person approving the config can judge ([ADR-0005](../adrs/0005-approve-every-dev-container-configs-exact-content-before-building-from-it.md)). Every other rule is a way out of the sandbox, or out of what approval covers.

##### 4.2.1.3. Container runtime sockets

WHILE a host path being checked has the file name `docker.sock`, `containerd.sock`, `podman.sock` or `buildkitd.sock`, config validation SHALL report a `docker-socket` violation, whether or not the path is inside an allowed root, AND SHALL NOT also check the path under §4.2.1.4.

##### 4.2.1.4. Host paths outside the allowed roots

WHILE a host path being checked lies outside every allowed root, config validation SHALL report a `host-paths` violation. It MUST compare the path and each root after resolving symlinks, so a link inside a root that points out of it is caught. It MUST compare a path that doesn't exist as written, since Docker would create it there. A path equal to a root MUST count as inside it.

##### 4.2.1.5. Details

Config validation SHALL set every violation's `detail` to name what was found. For a setting, the `detail` MUST name the setting and, where it has one, its value. For a host path, it MUST name the path. For the config's folder, it MUST name what the folder holds or contains.

#### 4.2.2. Compose services

These checks apply to every service in the model, the primary and sidecars alike, except where §4.2.2.3 distinguishes them.

##### 4.2.2.1. Privileged

WHILE a service sets `privileged: true`, config validation SHALL report a `privileged` violation.

##### 4.2.2.2. Host namespaces

WHILE a service sets any of `pid`, `ipc`, `uts`, `userns_mode` or `cgroup` to `host`, config validation SHALL report a `host-namespaces` violation for each such key.

##### 4.2.2.3. Network mode

WHILE the primary service sets any `network_mode`, config validation SHALL report a `network-mode` violation.

WHILE a sidecar sets `network_mode` to `host` or to `container:<anything>`, config validation SHALL report a `network-mode` violation.

WHILE a sidecar sets `network_mode` to `service:<name>`, config validation SHALL NOT report a `network-mode` violation.

> [!NOTE]
> Any network mode on the primary replaces its networks, including the one route out through the egress proxy. A sidecar sharing another service's network stack stays within networks devenv already restricts.

##### 4.2.2.4. Capabilities

WHILE a service's `cap_add` includes `ALL`, `SYS_ADMIN`, `NET_ADMIN`, `NET_RAW`, `SYS_PTRACE`, `SYS_MODULE`, `SYS_RAWIO`, `DAC_READ_SEARCH` or `BPF`, config validation SHALL report a `capabilities` violation for each. Matching MUST ignore case and an optional `CAP_` prefix.

##### 4.2.2.5. Security options

WHILE a service's `security_opt` includes `seccomp`, `apparmor` or `systempaths` set to `unconfined`, `label` set to `disable`, or `no-new-privileges` set to `false`, config validation SHALL report a `security-opt` violation for each. Matching MUST ignore case and MUST accept either `=` or `:` between key and value.

##### 4.2.2.6. Devices

WHILE a service maps one or more `devices`, config validation SHALL report a `devices` violation.

##### 4.2.2.7. Bind mounts

WHILE a service has a bind mount, config validation SHALL check the mount's source path under §4.2.1.3 and §4.2.1.4.

##### 4.2.2.8. Env files

WHILE a service lists an `env_file`, config validation SHALL check the file's path under §4.2.1.3 and §4.2.1.4.

##### 4.2.2.9. Build network

WHILE a service's `build.network` is `host`, config validation SHALL report a `build-network` violation.

##### 4.2.2.10. Build context and Dockerfile

WHILE a service has a `build.context`, config validation SHALL check the context under §4.2.1.3 and §4.2.1.4 AND SHALL check the service's Dockerfile, resolved against the context, the same way, so a Dockerfile outside the allowed roots is caught even when the context is inside one.

##### 4.2.2.11. Location

Config validation SHALL set the location of every violation it finds in a service to `service <name>`.

#### 4.2.3. Compose top level

These checks apply to the compose files themselves and to the top-level definitions some service uses.

##### 4.2.3.1. Compose files

Config validation SHALL check each compose file's path under §4.2.1.3 and §4.2.1.4. Each such violation's location MUST be `dev container config`.

##### 4.2.3.2. External networks

WHILE a network is declared `external: true`, config validation SHALL report an `external-networks` violation. Its location MUST be `network <name>`.

##### 4.2.3.3. Volume driver devices

WHILE a named volume sets `driver_opts.device`, config validation SHALL report a `volume-driver-opts` violation. Its location MUST be `volume <name>`.

##### 4.2.3.4. Secrets and `configs`

WHILE a Compose secret or Compose `configs` entry is sourced from a `file`, config validation SHALL check the `file`'s path under §4.2.1.3 and §4.2.1.4. Each such violation's location MUST be `secret <name>` or `config <name>`.

#### 4.2.4. Dev container config settings

These checks apply to the dev container config as written and to the merged config: the config together with what its Features and its base image's `devcontainer.metadata` label add (§4.3.3).

##### 4.2.4.1. Privileged

WHILE the config sets `privileged: true`, config validation SHALL report a `privileged` violation.

##### 4.2.4.2. Capabilities

WHILE the config's `capAdd` includes a capability listed in §4.2.2.4, config validation SHALL report a `capabilities` violation for each, matched as §4.2.2.4 specifies.

##### 4.2.4.3. Security options

WHILE the config's `securityOpt` includes an option listed in §4.2.2.5, config validation SHALL report a `security-opt` violation for each, matched as §4.2.2.5 specifies.

##### 4.2.4.4. Mounts

WHILE the config's `mounts` include a bind mount, config validation SHALL check the mount's source path under §4.2.1.3 and §4.2.1.4. It MUST recognize a bind mount written as a `type=bind,source=…` string, with `src=` accepted in place of `source=`, and one written as an object.

##### 4.2.4.5. Location

Config validation SHALL set the location of every violation §4.2.4.1 through §4.2.4.4 find in the config as written to `dev container config`, AND SHALL set the location of every violation they find in the merged config to `Features / base image metadata`.

#### 4.2.5. Raw compose files

Compose normalization inlines the files that `include:` and `extends: file:` pull in, so these checks read the compose files as written.

##### 4.2.5.1. Includes

WHILE a compose file has a top-level `include:`, config validation SHALL report a `compose-includes` violation. Its location MUST be the compose file's path.

##### 4.2.5.2. Extends from another file

WHILE a service in a compose file sets `extends` to an object with a `file`, config validation SHALL report a `compose-includes` violation. Its location MUST be `<file> service <name>`.

WHILE a service sets `extends` to the name of a service in the same file, config validation SHALL NOT report a `compose-includes` violation.

#### 4.2.6. Config folder

Approval covers the config's folder, and host paths inside it raise no `host-paths` finding, so these checks make sure the folder isn't far more than a config.

##### 4.2.6.1. Home directory

WHILE the config's folder is the home directory or an ancestor of it, config validation SHALL report one `config-folder` violation AND SHALL NOT also check under §4.2.6.2.

##### 4.2.6.2. Credentials

WHILE the config's folder directly holds `.ssh`, `.aws`, `.gnupg`, `.kube` or `.docker`, config validation SHALL report a `config-folder` violation for each.

##### 4.2.6.3. Location

Config validation SHALL set the location of every violation it reports to the config's folder.

### 4.3. Checking order

Resolving what the config's Features and base image add makes the devcontainer CLI read the config's Dockerfiles and pull its base image. That waits until the config as written is known not to break out of the sandbox.

#### 4.3.1. The config as written

Config validation SHALL first apply §4.2.6 to the config's folder AND SHALL apply §4.2.2 through §4.2.5 to the config as written.

#### 4.3.2. An escape stops further checks

WHILE the config as written contains a sandbox escape, config validation SHALL NOT resolve the merged config, so it reads none of the config's Dockerfiles and pulls none of its images.

#### 4.3.3. What Features and the base image add

WHILE the config as written contains no sandbox escape, config validation SHALL resolve the merged config AND SHALL apply §4.2.4 to it.

### 4.4. The escape report

#### 4.4.1. Every escape

The escape report SHALL list every sandbox escape config validation found, one line each, in the order config validation reported them.

#### 4.4.2. Unchecked Features and base image

WHILE the config as written contains a sandbox escape, the escape report SHALL include its line saying that what the config's Features and base image add is checked once the escapes are fixed.

### 4.5. `devenv container validate`

#### 4.5.1. What it validates

`devenv container validate` SHALL resolve its worktree as RFC-0002 §4.4 specifies, AND SHALL resolve that worktree's config as RFC-0003 specifies, AND SHALL run config validation on that config.

#### 4.5.2. Sandbox escapes

WHILE the config contains a sandbox escape, `devenv container validate` SHALL fail (RFC-0001 §4.3), with the escape report (§3.2) as its `error:` message.

#### 4.5.3. Host exposure

WHILE the config exposes host files, `devenv container validate` SHALL print a host exposure warning (§3.2) for each host exposure found.

#### 4.5.4. No escapes

WHILE the config contains no sandbox escape, `devenv container validate` SHALL print `valid: <config>` on stdout AND SHALL exit with status `0`.

## 5. Examples

### 5.1. An escape stops the merged check

Setup: `worktrees/app/main`'s config has a primary service `app` that sets `privileged: true` and bind-mounts `/var/run/docker.sock`.

Call: `devenv container validate app main`

Result: exit status `1`, the base image never pulled, and on stderr:

```text
error: the dev container config breaks devenv's sandbox rules:
  - service app: privileged: true [privileged]
  - service app: bind mount /var/run/docker.sock -> /var/run/docker.sock [docker-socket]
  (what its Features and base image add is checked once these are fixed)
  see docs/agent-container-security.md (sections named by the [rule]), or pick another config with --config <path>
```

### 5.2. A Feature adds an escape

Setup: the config itself breaks no rule, and lists the `docker-in-docker` Feature, which sets `privileged: true`.

Call: `devenv container validate app main`

Result: exit status `1`, and an escape report with one escape, `Features / base image metadata: privileged: true [privileged]`, and no line about unchecked Features.

### 5.3. Host exposure is only a warning

Setup: the primary service bind-mounts `/home/dev/.cache/tool` at `/cache`, outside the worktree and the config's folder.

Call: `devenv container validate app main`

Result: exit status `0`. On stderr:

```text
warning: service app: bind mount /home/dev/.cache/tool -> /cache is outside the worktree and the config's folder [host-paths]
```

On stdout:

```text
valid: /home/dev/devenv/worktrees/app/main/.devcontainer/devcontainer.json
```

## 6. Out of scope

- What other commands do with findings: whether an escape blocks creating a sandbox or is only reported for one that already exists, and how `devenv container trust` treats a config with escapes. Specified in RFC-0005 (config approval) and RFC-0007 (sandbox lifecycle).
- Resolving the worktree and its config. Specified in RFC-0002 §4.4 and RFC-0003.
- Settings that devenv overrides rather than rejects: published ports, `container_name`, fixed subnets, project networks, and commands that run on the host. Specified in RFC-0006 (the sandbox layer).
- What a config's build steps and Features do. Config validation can't judge them; that's review's job ([ADR-0005](../adrs/0005-approve-every-dev-container-configs-exact-content-before-building-from-it.md)).
- Image- and Dockerfile-based configs, and their `runArgs` [future]. Only Compose-based configs are supported ([ADR-0004](../adrs/0004-define-sandboxes-with-standard-dev-container-configs.md)); supporting the others means checking `runArgs`, which pass arbitrary `docker run` arguments, and §4.2.4 is where such checks would go.

## 7. Open questions

- `devenv container validate` exits `1` both when the config contains a sandbox escape and when it can't validate the config at all. Should CI be able to tell them apart, with a distinct exit status for escapes? If so, RFC-0001 §3.3, which owns the exit statuses, would need to allow a status particular to one command.
- `pid`, `ipc` and the other namespace keys are only checked for `host` (§4.2.2.2). Should `container:<name>`, which joins another container's namespace (possibly another sandbox's), also be a violation?
- `volumes_from`, which mounts another container's volumes, isn't checked. Should it be?
- Named volumes declared `external: true` aren't checked, so a config can mount any existing volume, including one belonging to another sandbox. Should they be a violation, or host exposure for the reviewer?
- The merged config includes the config's own settings, not only what Features and the base image add. If that holds for `mounts`, a host path in the config's own mounts is reported twice, once by §4.3.1 and once by §4.3.3. This needs verifying; if true, should the merged config's findings leave out what the config as written already contains?
- A dev container config value of the wrong type is skipped, not rejected: a `capAdd` or `securityOpt` that isn't an array, a non-string item in one, a `mounts` that isn't an array (§4.2.4). If the devcontainer CLI would still apply such a value, for example a `capAdd` given as a single string, it passes config validation unchecked. This needs verifying against the CLI; should config validation reject malformed values instead of skipping them?
