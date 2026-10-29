import { realpathSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { ComposeModel, ComposeService } from "./compose.ts";
import type { DevcontainerConfig } from "./config.ts";

/** Why a project config can't be used as-is: one rule broken in one place. */
export interface Violation {
  /** Stable rule id; also the anchor of its explanation in docs/agent-container-security.md. */
  readonly rule: ViolationRule;
  /** Where the problem is: a compose service, or the dev container config itself. */
  readonly location: string;
  /** What was found. */
  readonly detail: string;
}

/** The rules a project config is checked against. */
export type ViolationRule =
  | "privileged"
  | "host-namespaces"
  | "network-mode"
  | "capabilities"
  | "security-opt"
  | "devices"
  | "host-paths"
  | "docker-socket"
  | "volume-driver-opts"
  | "external-networks"
  | "build-network"
  | "compose-includes";

/** What a project config is validated against. */
export interface ValidationInput {
  /** The project's normalized compose model, without devenv's override. */
  readonly model: ComposeModel;
  /** The dev container's primary service. */
  readonly primaryService: string;
  /** The dev container config as written (without what its Features or base image contribute). */
  readonly devcontainerConfig: DevcontainerConfig;
  /** Absolute paths of the project's compose files. */
  readonly composeFiles: readonly string[];
  /** The project's compose files as written, for what normalization hides. */
  readonly rawComposeFiles: readonly { readonly path: string; readonly text: string }[];
  /** Host path of the worktree; every host path a config uses must resolve inside it. */
  readonly worktreePath: string;
}

// Capabilities that are known container-escape or host-impact routes.
const DANGEROUS_CAPABILITIES: ReadonlySet<string> = new Set([
  "ALL",
  "SYS_ADMIN",
  "NET_ADMIN",
  "NET_RAW",
  "SYS_PTRACE",
  "SYS_MODULE",
  "SYS_RAWIO",
  "DAC_READ_SEARCH",
  "BPF",
]);

const HOST_NAMESPACE_KEYS = ["pid", "ipc", "uts", "userns_mode", "cgroup"] as const;
const SOCKET_NAMES: ReadonlySet<string> = new Set(["docker.sock", "containerd.sock", "podman.sock", "buildkitd.sock"]);

/**
 * Checks a project config for anything that would weaken devenv's sandbox: access to the host (privileges,
 * namespaces, devices, host paths, the Docker daemon) or a way around the egress proxy.
 *
 * @param input - The project config, as compose and the devcontainer CLI resolve it.
 * @returns Every violation found, in a stable order; empty when the config is acceptable.
 */
export function validateProjectConfig(input: ValidationInput): Violation[] {
  const worktree = resolveReal(input.worktreePath);
  const violations: Violation[] = [];
  const add = (rule: ViolationRule, location: string, detail: string): void => {
    violations.push({ rule, location, detail });
  };

  for (const file of input.composeFiles) {
    checkHostPath("dev container config", `compose file ${file}`, file, worktree, add);
  }
  for (const [name, service] of Object.entries(input.model.services)) {
    checkService(`service ${name}`, service, name === input.primaryService, worktree, add);
  }
  checkTopLevel(input.model, worktree, add);
  checkDevcontainerConfig(input.devcontainerConfig, worktree, add, "dev container config");
  checkRawComposeFiles(input.rawComposeFiles, add);
  return violations;
}

/**
 * Checks what a config's Features and its base image's devcontainer.metadata label add to it, as
 * `read-configuration --include-merged-configuration` reports them — before anything is built. Run after
 * {@link validateProjectConfig} passes: resolving them makes the devcontainer CLI read the config's Dockerfiles, which
 * must first be confirmed to be inside the worktree.
 *
 * @param merged - The merged config.
 * @param worktreePath - Host path of the worktree; bind mounts must resolve inside it.
 * @returns Every violation found; empty when acceptable.
 *
 * @remarks
 * A LABEL in the project's own Dockerfile needs no check: the CLI ignores it, stamping the final image's label from
 * the base image, Features, and config.
 */
export function validateMergedConfig(merged: DevcontainerConfig, worktreePath: string): Violation[] {
  const violations: Violation[] = [];
  checkDevcontainerConfig(merged, resolveReal(worktreePath), (rule, location, detail) => {
    violations.push({ rule, location, detail });
  }, "Features / base image metadata");
  return violations;
}

type AddViolation = (rule: ViolationRule, location: string, detail: string) => void;

/** Checks one compose service's own settings; the primary is held to a stricter network rule. */
function checkService(location: string, service: ComposeService, isPrimary: boolean, worktree: string, add: AddViolation): void {
  if (service.privileged === true) {
    add("privileged", location, "privileged: true");
  }
  for (const key of HOST_NAMESPACE_KEYS) {
    if (service[key] === "host") {
      add("host-namespaces", location, `${key}: host`);
    }
  }
  checkNetworkMode(location, service.network_mode, isPrimary, add);
  for (const capability of service.cap_add ?? []) {
    checkCapability(location, capability, add);
  }
  for (const option of service.security_opt ?? []) {
    checkSecurityOpt(location, option, add);
  }
  if ((service.devices ?? []).length > 0) {
    add("devices", location, `devices: ${service.devices?.length} mapped`);
  }
  for (const volume of service.volumes ?? []) {
    if (volume.type === "bind" && volume.source !== undefined) {
      checkHostPath(location, `bind mount ${volume.source} -> ${volume.target}`, volume.source, worktree, add);
    }
  }
  for (const envFile of service.env_file ?? []) {
    checkHostPath(location, `env_file ${envFile.path}`, envFile.path, worktree, add);
  }
  if (service.build?.network === "host") {
    add("build-network", location, "build.network: host");
  }
  if (service.build?.context !== undefined) {
    checkHostPath(location, `build context ${service.build.context}`, service.build.context, worktree, add);
    if (service.build.dockerfile !== undefined) {
      const dockerfile = path.resolve(service.build.context, service.build.dockerfile);
      checkHostPath(location, `dockerfile ${dockerfile}`, dockerfile, worktree, add);
    }
  }
}

/**
 * The primary is the agent's container: any network_mode would replace its networks (proxy_net included). Sidecars
 * may share another service's stack (service:<name>), which is already restricted, but not the host's or an
 * arbitrary container's.
 */
function checkNetworkMode(location: string, networkMode: string | null | undefined, isPrimary: boolean, add: AddViolation): void {
  if (networkMode === undefined || networkMode === null) {
    return;
  }
  if (isPrimary || networkMode === "host" || networkMode.startsWith("container:")) {
    add("network-mode", location, `network_mode: ${networkMode}`);
  }
}

/** Flags a capability on the escape-route list, however it's spelled (`cap_net_admin`, `NET_ADMIN`). */
function checkCapability(location: string, capability: string, add: AddViolation): void {
  const normalized = capability.toUpperCase().replace(/^CAP_/, "");
  if (DANGEROUS_CAPABILITIES.has(normalized)) {
    add("capabilities", location, `cap_add: ${capability}`);
  }
}

/** Flags security options that switch off seccomp, AppArmor, SELinux labeling, or no-new-privileges. */
function checkSecurityOpt(location: string, option: string, add: AddViolation): void {
  const [key = "", value = ""] = option.toLowerCase().split(/[=:]/, 2);
  const isDisabling =
    ((key === "seccomp" || key === "apparmor" || key === "systempaths") && value === "unconfined") ||
    (key === "label" && value === "disable") ||
    (key === "no-new-privileges" && value === "false");
  if (isDisabling) {
    add("security-opt", location, `security_opt: ${option}`);
  }
}

/**
 * Flags a host path outside the worktree, or a container runtime socket anywhere. Compared after resolving
 * symlinks, so a link inside the worktree pointing out of it is caught; a path that doesn't exist yet is checked as
 * written, since Docker would create it there.
 */
function checkHostPath(location: string, description: string, hostPath: string, worktree: string, add: AddViolation): void {
  if (SOCKET_NAMES.has(path.basename(hostPath))) {
    add("docker-socket", location, description);
    return;
  }
  if (!isInside(resolveReal(hostPath), worktree)) {
    add("host-paths", location, `${description} is outside the worktree`);
  }
}

/** Checks the project's top-level networks, volumes, secrets and configs that some service uses. */
function checkTopLevel(model: ComposeModel, worktree: string, add: AddViolation): void {
  for (const [name, network] of Object.entries(model.networks ?? {})) {
    if (network.external === true) {
      add("external-networks", `network ${name}`, "external: true");
    }
  }
  for (const [name, volume] of Object.entries(model.volumes ?? {})) {
    if (volume.driver_opts?.device !== undefined) {
      add("volume-driver-opts", `volume ${name}`, `driver_opts.device: ${volume.driver_opts.device}`);
    }
  }
  for (const [kind, entries] of [
    ["secret", model.secrets],
    ["config", model.configs],
  ] as const) {
    for (const [name, reference] of Object.entries(entries ?? {})) {
      if (reference.file !== undefined) {
        checkHostPath(`${kind} ${name}`, `file ${reference.file}`, reference.file, worktree, add);
      }
    }
  }
}

/** Checks devcontainer.json-level settings: privileged, capAdd, securityOpt, and bind mounts. */
function checkDevcontainerConfig(merged: DevcontainerConfig, worktree: string, add: AddViolation, location: string): void {
  if (merged.privileged === true) {
    add("privileged", location, "privileged: true");
  }
  for (const capability of stringList(merged.capAdd)) {
    checkCapability(location, capability, add);
  }
  for (const option of stringList(merged.securityOpt)) {
    checkSecurityOpt(location, option, add);
  }
  for (const mount of Array.isArray(merged.mounts) ? merged.mounts : []) {
    const { type, source } = parseDevcontainerMount(mount);
    if (type === "bind" && source !== undefined) {
      checkHostPath(location, `mount ${source}`, source, worktree, add);
    }
  }
}

/** Flags `include:` and `extends: file:` — normalization inlines those files, so they'd escape the trust snapshot. */
function checkRawComposeFiles(files: readonly { readonly path: string; readonly text: string }[], add: AddViolation): void {
  for (const file of files) {
    const document: unknown = parse(file.text);
    if (typeof document !== "object" || document === null) {
      continue;
    }
    const record: Record<string, unknown> = { ...document };
    if (record.include !== undefined) {
      add("compose-includes", file.path, "include:");
    }
    const services = typeof record.services === "object" && record.services !== null ? record.services : {};
    for (const [name, service] of Object.entries(services)) {
      const extendsValue: unknown = typeof service === "object" && service !== null && "extends" in service ? service.extends : undefined;
      // `extends: <service>` names a service in the same file; only the object form's `file:` pulls in another.
      const hasFile = typeof extendsValue === "object" && extendsValue !== null && "file" in extendsValue;
      if (hasFile) {
        add("compose-includes", `${file.path} service ${name}`, "extends: file");
      }
    }
  }
}

/** Reads a devcontainer.json mount, either a `type=bind,source=/x,target=/y` string or an object. */
function parseDevcontainerMount(mount: unknown): { type?: string; source?: string } {
  if (typeof mount === "string") {
    const fields = Object.fromEntries(
      mount.split(",").map((pair) => {
        const [key = "", ...rest] = pair.split("=");
        return [key.trim(), rest.join("=").trim()];
      }),
    );
    return { type: fields.type, source: fields.source ?? fields.src };
  }
  if (typeof mount === "object" && mount !== null) {
    const type = "type" in mount && typeof mount.type === "string" ? mount.type : undefined;
    const source = "source" in mount && typeof mount.source === "string" ? mount.source : undefined;
    return { type, source };
  }
  return {};
}

/** The string items of a value that should be a string array, or none. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** A path with symlinks resolved, or as written when it doesn't exist (yet). */
function resolveReal(hostPath: string): string {
  try {
    return realpathSync(hostPath);
  } catch {
    return path.resolve(hostPath);
  }
}

/** Whether a path is the root or anywhere beneath it. */
function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
