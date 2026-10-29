import path from "node:path";
import { type ScalarTag, stringify } from "yaml";
import type { ComposeModel } from "./compose.ts";
import type { GeneratorContext } from "./context.ts";
import type { WorktreeGitLayout } from "./git.ts";
import { containerPathOf } from "./paths.ts";

/** Marks a key compose should drop from the merged result, rendered as compose's `!reset null`. */
export const COMPOSE_RESET: unique symbol = Symbol("compose-reset");

/** {@link COMPOSE_RESET}, as a type. */
export type ComposeReset = typeof COMPOSE_RESET;

/** A long-syntax compose `volumes:` entry. */
export type ComposeMount =
  | { readonly type: "bind"; readonly source: string; readonly target: string; readonly read_only: boolean }
  | { readonly type: "tmpfs"; readonly target: string; readonly read_only: boolean };

/** The compose override file devenv appends after a config's own compose files. */
export interface ComposeOverride {
  /** The compose project name. */
  readonly name: string;
  /** Per-service overrides, keyed by service name. */
  readonly services: Readonly<Record<string, ComposeServiceOverride>>;
  /** Per-network overrides, keyed by network key. */
  readonly networks: Readonly<Record<string, ComposeNetworkOverride>>;
}

/** Settings merged over one service. Absent fields leave the service's own untouched. */
export interface ComposeServiceOverride {
  /** Fixed per-worktree container name that exec consumers address, or a reset of the project's own. */
  readonly container_name?: string | ComposeReset;
  /** The worktree's container path. */
  readonly working_dir?: string;
  /** Network keys, added to the service's own. */
  readonly networks?: readonly string[];
  /** Environment variables merged over the service's own. */
  readonly environment?: Readonly<Record<string, string>>;
  /** Mounts merged over the service's own, by target. */
  readonly volumes?: readonly ComposeMount[];
  /** A reset of the project's published ports. */
  readonly ports?: ComposeReset;
}

/** The external proxy network, or the fixes applied to one of the project's own networks. */
export type ComposeNetworkOverride =
  | { readonly external: true; readonly name: string }
  | {
      readonly internal: true;
      readonly driver_opts: Readonly<Record<string, string>>;
      readonly ipam?: ComposeReset;
    };

/** The override plus what it changed in the project's own config, for reporting to the user. */
export interface OverrideResult {
  /** The override, ready for {@link renderOverride}. */
  readonly override: ComposeOverride;
  /** One line per automatic fix applied to the project's config. */
  readonly notices: readonly string[];
}

const PROXY_URL = "http://firewall:3128";
const PROXY_NETWORK_KEY = "proxy_net";

/**
 * Builds the override every devenv container gets: the agent layer on the config's primary service, plus the fixes
 * that keep the rest of the project inside the sandbox and let several worktrees of it run at once.
 *
 * @param context - The worktree and host description.
 * @param model - The config's normalized compose model, without this override.
 * @param primaryService - The config's primary service name.
 * @param git - The worktree's git layout, from {@link resolveWorktreeGitLayout}.
 * @returns The override and the fixes it applied.
 */
export function buildOverride(
  context: GeneratorContext,
  model: ComposeModel,
  primaryService: string,
  git: WorktreeGitLayout,
): OverrideResult {
  const notices: string[] = [];
  const services: Record<string, ComposeServiceOverride> = {};

  for (const [name, service] of Object.entries(model.services)) {
    const fixes: { -readonly [K in keyof ComposeServiceOverride]: ComposeServiceOverride[K] } = {};
    // Containers sit on internal networks only, where Docker never publishes ports anyway; resetting them keeps that
    // true even if a service ever got a non-internal network, where a 0.0.0.0 port would reach the whole LAN.
    if ((service.ports ?? []).length > 0) {
      fixes.ports = COMPOSE_RESET;
      notices.push(`service ${name}: published ports removed (containers are on internal networks only)`);
    }
    // A fixed name collides as soon as a second worktree of the project runs.
    if (name !== primaryService && service.container_name) {
      fixes.container_name = COMPOSE_RESET;
      notices.push(`service ${name}: container_name removed (it would collide across worktrees)`);
    }
    const worktreeGitPins = worktreeGitPinsFor(context, service.volumes ?? []);
    if (worktreeGitPins.length > 0) {
      fixes.volumes = worktreeGitPins;
    }
    if (Object.keys(fixes).length > 0) {
      services[name] = fixes;
    }
  }

  services[primaryService] = {
    ...services[primaryService],
    ...agentLayer(context, model, primaryService, git, services[primaryService]?.volumes ?? []),
  };

  return {
    override: { name: context.projectName, services, networks: networkOverrides(context, model, primaryService, notices) },
    notices,
  };
}

/**
 * The agent layer on the primary service: identity, network, proxy env, and the mounts that make it a devenv agent
 * container.
 */
function agentLayer(
  context: GeneratorContext,
  model: ComposeModel,
  primaryService: string,
  git: WorktreeGitLayout,
  projectPins: readonly ComposeMount[],
): ComposeServiceOverride {
  const { containerRepoDir, containerClaudeDir } = context;
  return {
    container_name: `${context.projectName}-devcontainer`,
    working_dir: containerPathOf(context, context.worktreePath),
    // proxy_net is the primary's only way out — no route to the approver (decision authority) or the internet except
    // through Squid. Owned by the shared stack; compose can't depends_on across projects, so lib/container.sh brings
    // that stack up and waits for it to be healthy first.
    networks: [...primaryProjectNetworks(model, primaryService), PROXY_NETWORK_KEY],
    environment: {
      HTTP_PROXY: PROXY_URL,
      HTTPS_PROXY: PROXY_URL,
      http_proxy: PROXY_URL,
      https_proxy: PROXY_URL,
      NO_PROXY: "localhost,127.0.0.1",
      no_proxy: "localhost,127.0.0.1",
      // Node 22+ built-in http/https only honor the proxy vars with this.
      NODE_USE_ENV_PROXY: "1",
      CLAUDE_CONFIG_DIR: containerClaudeDir,
    },
    volumes: [
      // Read-only, so the firewall allowlist and devenv's own config are out of a sandboxed process's reach.
      bindMount(context.repoDir, containerRepoDir, true),
      // Masks every repo's checkouts (uncommitted work, gitignored secrets like .env); only the binds layered on top
      // show. Read-only: it exists only to mask, and writable it'd be an uncapped RAM-backed scratch dir.
      { type: "tmpfs", target: path.posix.join(containerRepoDir, "worktrees"), read_only: true },
      // This worktree's own Claude data dir: sessions, history and .claude.json survive rebuilds but are never shared
      // — a shared session registry made every container list every other container's agents.
      bindMount(context.claudeDataDir, containerClaudeDir, false),
      // From the host's own Claude config, only auth (read-write, for token refresh) and settings.json (read-only).
      // Everything else in ~/.claude and ~/.claude.json steers the HOST's Claude — settings hooks and mcpServers are
      // commands it runs, skills/commands/rules/CLAUDE.md are instructions it follows — so a writable mount of any of
      // it is a way out of the sandbox. The repo-tracked config is linked from the read-only /devenv instead, by the
      // agent Feature's postStartCommand (`devenv link`).
      hostClaudeMount(context, ".credentials.json", false),
      hostClaudeMount(context, "settings.json", true),
      // This worktree and its bare repo read-write at their mirrored paths, so relative gitdir links resolve, with
      // read-only pins over everything git takes config or hooks from. Without them a sandboxed process could plant
      // core.hooksPath/core.fsmonitor, or repoint the .git file or commondir at a config it controls, and get code
      // execution on the host the next time git runs there. Known gap: submodule git dirs (<bare>/modules/) stay
      // writable.
      mirrorMount(context, context.worktreePath, false),
      mirrorMount(context, path.join(context.worktreePath, ".git"), true),
      mirrorMount(context, git.bare, false),
      mirrorMount(context, path.join(git.bare, "config"), true),
      mirrorMount(context, path.join(git.bare, "hooks"), true),
      mirrorMount(context, path.join(git.bare, "worktrees"), true),
      mirrorMount(context, git.admin, false),
      mirrorMount(context, path.join(git.admin, "commondir"), true),
      // Other repos: committed history only, for cross-project research.
      ...git.otherBares.map((otherBare) => mirrorMount(context, otherBare, true)),
      ...projectPins,
    ],
  };
}

/**
 * Read-only pins over the worktree's `.git` file wherever a project mounts the whole worktree at a path of its own
 * (e.g. `..:/workspaces/app`) — otherwise that file, which host-side git trusts, is writable there.
 */
function worktreeGitPinsFor(context: GeneratorContext, volumes: readonly { type: string; source?: string; target: string }[]): ComposeMount[] {
  return volumes
    .filter((volume) => volume.type === "bind" && volume.source === context.worktreePath)
    .map((volume) => bindMount(path.join(context.worktreePath, ".git"), path.posix.join(volume.target, ".git"), true));
}

/**
 * The primary's own project networks, kept alongside proxy_net so it still reaches its sidecars. Compose spells out
 * the implicit `default` network; it's dropped when no other service is on it, since then it reaches nothing.
 */
function primaryProjectNetworks(model: ComposeModel, primaryService: string): string[] {
  const own = Object.keys(model.services[primaryService]?.networks ?? {});
  const isDefaultShared = Object.entries(model.services).some(
    ([name, service]) => name !== primaryService && Object.hasOwn(service.networks ?? {}, "default"),
  );
  return own.filter((network) => network !== "default" || isDefaultShared);
}

/**
 * proxy_net's definition, plus the fixes for each of the project's own networks: internal (no egress except the
 * primary's, via Squid), without a host-side address (no route to host services), and without fixed subnets (which
 * collide across worktrees).
 */
function networkOverrides(
  context: GeneratorContext,
  model: ComposeModel,
  primaryService: string,
  notices: string[],
): Record<string, ComposeNetworkOverride> {
  const networks: Record<string, ComposeNetworkOverride> = {
    [PROXY_NETWORK_KEY]: { external: true, name: context.proxyNetwork },
  };
  const used = new Set([
    ...primaryProjectNetworks(model, primaryService),
    ...Object.entries(model.services)
      .filter(([name]) => name !== primaryService)
      .flatMap(([, service]) => Object.keys(service.networks ?? {})),
  ]);
  for (const [key, network] of Object.entries(model.networks ?? {})) {
    if (network.external === true || !used.has(key)) {
      continue;
    }
    const hasFixedSubnet = (network.ipam?.config ?? []).length > 0;
    if (hasFixedSubnet) {
      notices.push(`network ${key}: fixed subnet removed (it would collide across worktrees)`);
    }
    networks[key] = {
      internal: true,
      driver_opts: { "com.docker.network.bridge.inhibit_ipv4": "true" },
      ...(hasFixedSubnet ? { ipam: COMPOSE_RESET } : {}),
    };
  }
  return networks;
}

/** A bind mount of a host path onto a container path. */
function bindMount(source: string, target: string, isReadOnly: boolean): ComposeMount {
  return { type: "bind", source, target, read_only: isReadOnly };
}

/**
 * A bind mount of one entry from the host user's own `~/.claude` into the container's Claude config dir, at the same
 * relative path.
 */
function hostClaudeMount(context: GeneratorContext, entry: string, isReadOnly: boolean): ComposeMount {
  return bindMount(path.join(context.home, ".claude", entry), path.posix.join(context.containerClaudeDir, entry), isReadOnly);
}

/**
 * A bind mount of a host path under the devenv repo at its mirrored container path (see {@link containerPathOf}) —
 * what keeps relative gitdir links resolving inside the container.
 */
function mirrorMount(context: GeneratorContext, hostPath: string, isReadOnly: boolean): ComposeMount {
  return bindMount(hostPath, containerPathOf(context, hostPath), isReadOnly);
}

const resetTag: ScalarTag = {
  tag: "!reset",
  identify: (value) => value === COMPOSE_RESET,
  resolve: () => COMPOSE_RESET,
  stringify: () => "null",
};

/**
 * Serializes an override as compose YAML, with {@link COMPOSE_RESET} rendered as `!reset null`.
 *
 * @param override - The override from {@link buildOverride}.
 * @returns The YAML document.
 */
export function renderOverride(override: ComposeOverride): string {
  return stringify(override, { customTags: [resetTag] });
}
