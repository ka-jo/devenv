import path from "node:path";
import { stringify } from "yaml";
import type { GeneratorContext } from "./context.ts";
import type { WorktreeGitLayout } from "./git.ts";
import { containerPathOf } from "./paths.ts";

/** A long-syntax compose `volumes:` entry. */
export type ComposeMount =
  | { readonly type: "bind"; readonly source: string; readonly target: string; readonly read_only: boolean }
  | { readonly type: "tmpfs"; readonly target: string; readonly read_only: boolean };

/** The compose override file devenv appends after a config's own compose files. */
export interface ComposeOverride {
  /** The compose project name. */
  readonly name: string;
  /** Overrides for the config's primary service, keyed by its name. */
  readonly services: Readonly<Record<string, ComposeServiceOverride>>;
  /** The external proxy network definition. */
  readonly networks: Readonly<Record<string, { readonly external: true; readonly name: string }>>;
}

/** The agent layer's settings on the primary service. */
export interface ComposeServiceOverride {
  /** Fixed per-worktree container name that exec consumers address. */
  readonly container_name: string;
  /** The worktree's container path. */
  readonly working_dir: string;
  /** Network names, by their key in {@link ComposeOverride.networks}. */
  readonly networks: readonly string[];
  /** Environment variables merged over the service's own. */
  readonly environment: Readonly<Record<string, string>>;
  /** Mounts merged over the service's own, by target. */
  readonly volumes: readonly ComposeMount[];
}

const PROXY_URL = "http://firewall:3128";

/**
 * Builds the agent layer every devenv container gets on top of its config's own primary service.
 *
 * @param context - The worktree and host description.
 * @param service - The config's primary service name.
 * @param git - The worktree's git layout, from {@link resolveWorktreeGitLayout}.
 * @returns The override, ready for {@link renderOverride}.
 */
export function buildOverride(context: GeneratorContext, service: string, git: WorktreeGitLayout): ComposeOverride {
  const { containerRepoDir, containerClaudeDir } = context;
  return {
    name: context.projectName,
    services: {
      [service]: {
        container_name: `${context.projectName}-devcontainer`,
        working_dir: containerPathOf(context, context.worktreePath),
        // proxy_net ONLY: the container's sole reach is Squid — no route to the approver (decision authority) or the
        // internet except through it. Owned by the shared stack; compose can't depends_on across projects, so
        // lib/container.sh brings that stack up and waits for it to be healthy first.
        networks: ["proxy_net"],
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
          // Masks every repo's checkouts (uncommitted work, gitignored secrets like .env); only the binds layered on
          // top show. Read-only: it exists only to mask, and writable it'd be an uncapped RAM-backed scratch dir.
          { type: "tmpfs", target: path.posix.join(containerRepoDir, "worktrees"), read_only: true },
          // This worktree's own Claude data dir: sessions, history and .claude.json survive rebuilds but are never
          // shared — a shared session registry made every container list every other container's agents.
          bindMount(context.claudeDataDir, containerClaudeDir, false),
          // From the host's own Claude config, only auth (read-write, for token refresh) and settings.json
          // (read-only). Everything else in ~/.claude and ~/.claude.json steers the HOST's Claude — settings hooks
          // and mcpServers are commands it runs, skills/commands/rules/CLAUDE.md are instructions it follows — so a
          // writable mount of any of it is a way out of the sandbox. The repo-tracked config is linked from the
          // read-only /devenv instead, by the agent Feature's postStartCommand (`devenv link`).
          hostClaudeMount(context, ".credentials.json", false),
          hostClaudeMount(context, "settings.json", true),
          // This worktree and its bare repo read-write at their mirrored paths, so relative gitdir links resolve,
          // with read-only pins over everything git takes config or hooks from. Without them a sandboxed process
          // could plant core.hooksPath/core.fsmonitor, or repoint the .git file or commondir at a config it
          // controls, and get code execution on the host the next time git runs there. Known gap: submodule git
          // dirs (<bare>/modules/) stay writable.
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
        ],
      },
    },
    networks: { proxy_net: { external: true, name: context.proxyNetwork } },
  };
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
  return bindMount(
    path.join(context.home, ".claude", entry),
    path.posix.join(context.containerClaudeDir, entry),
    isReadOnly,
  );
}

/**
 * A bind mount of a host path under the devenv repo at its mirrored container path (see {@link containerPathOf}) —
 * what keeps relative gitdir links resolving inside the container.
 */
function mirrorMount(context: GeneratorContext, hostPath: string, isReadOnly: boolean): ComposeMount {
  return bindMount(hostPath, containerPathOf(context, hostPath), isReadOnly);
}

/**
 * Serializes an override as compose YAML.
 *
 * @param override - The override from {@link buildOverride}.
 * @returns The YAML document.
 */
export function renderOverride(override: ComposeOverride): string {
  return stringify(override);
}
