import path from "node:path";
import { GeneratorError } from "./errors.ts";

/**
 * Everything the generator needs to know about one worktree and the host, as
 * supplied by `lib/container.sh` (which owns these values) on stdin — except
 * the container paths, which are derived from {@link GeneratorContext.containerHome}.
 */
export interface GeneratorContext {
  /** Host path of the devenv repo, `~/devenv`. */
  readonly repoDir: string;
  /** Host directory holding every repo's bare clone and worktrees, `~/devenv/worktrees`. */
  readonly worktreesDir: string;
  /** Repo name, the `<repo>` in `worktrees/<repo>/<branch>`. */
  readonly repo: string;
  /** Branch name, the `<branch>` in `worktrees/<repo>/<branch>`. */
  readonly branch: string;
  /** Host path of the worktree checkout. */
  readonly worktreePath: string;
  /** Compose project name, `<repo>-<branch>` normalized. */
  readonly projectName: string;
  /** The host user's home directory. */
  readonly home: string;
  /** Host-only generated-state directory for this worktree; never mounted into any container. */
  readonly stateDir: string;
  /** Host directory mounted read-write at {@link GeneratorContext.containerClaudeDir}. */
  readonly claudeDataDir: string;
  /**
   * The container's remote user's home directory, read from the built image. `/` is the layout of containers created
   * before devenv mounted under the user's home (`/devenv`, `/.claude`), and what's used before an image exists.
   */
  readonly containerHome: string;
  /** Where {@link GeneratorContext.repoDir} is mounted inside the container: `<containerHome>/devenv`. */
  readonly containerRepoDir: string;
  /** Claude Code's `CLAUDE_CONFIG_DIR` inside the container: `<containerHome>/.claude`, beside the repo as on the host. */
  readonly containerClaudeDir: string;
  /** Docker name of the shared stack's internal proxy network. */
  readonly proxyNetwork: string;
  /** The default `devcontainer.json`, used when nothing else picks one. */
  readonly defaultConfig: string;
  /** devenv's local Features directory. */
  readonly featuresDir: string;
  /** Path of the pinned devcontainer CLI executable. */
  readonly devcontainerCli: string;
  /** Host-only directory of approved project config snapshots, shared by every worktree; never mounted. */
  readonly trustDir: string;
  /** Absolute path of a config (file or folder) to use instead of the one the worktree would otherwise get. */
  readonly configPath?: string;
  /**
   * Whether this run precedes building and creating a container. Only then do a project config's violations or
   * missing approval block; for an existing container nothing would be built from them, so they're warnings.
   */
  readonly isCreating: boolean;
}

/**
 * Parses the JSON context `lib/container.sh` sends, checking every required {@link GeneratorContext} field is present:
 * paths and names as non-empty strings, flags as booleans, and the container home as a normalized absolute path (it
 * comes from the image, which the project controls). An optional field may be absent or empty. The container paths
 * are derived, not read.
 *
 * @param json - The raw JSON text.
 * @returns The validated context.
 * @throws {@link GeneratorError} when the text isn't JSON, or naming the first missing or malformed field.
 */
export function parseGeneratorContext(json: string): GeneratorContext {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new GeneratorError(`generator context isn't valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new GeneratorError("generator context must be a JSON object");
  }
  const record: Record<string, unknown> = { ...raw };
  const field = (key: keyof GeneratorContext): string => {
    const value = record[key];
    if (typeof value !== "string" || value === "") {
      throw new GeneratorError(`generator context is missing "${key}"`);
    }
    return value;
  };
  const flag = (key: keyof GeneratorContext): boolean => {
    const value = record[key];
    if (typeof value !== "boolean") {
      throw new GeneratorError(`generator context is missing "${key}"`);
    }
    return value;
  };
  const containerHome = field("containerHome");
  if (!isNormalizedAbsolute(containerHome)) {
    throw new GeneratorError(`generator context has a malformed "containerHome": ${JSON.stringify(containerHome)}`);
  }

  return {
    repoDir: field("repoDir"),
    worktreesDir: field("worktreesDir"),
    repo: field("repo"),
    branch: field("branch"),
    worktreePath: field("worktreePath"),
    projectName: field("projectName"),
    home: field("home"),
    stateDir: field("stateDir"),
    claudeDataDir: field("claudeDataDir"),
    containerHome,
    containerRepoDir: path.posix.join(containerHome, "devenv"),
    containerClaudeDir: path.posix.join(containerHome, ".claude"),
    proxyNetwork: field("proxyNetwork"),
    defaultConfig: field("defaultConfig"),
    featuresDir: field("featuresDir"),
    devcontainerCli: field("devcontainerCli"),
    trustDir: field("trustDir"),
    ...(typeof record.configPath === "string" && record.configPath !== "" ? { configPath: record.configPath } : {}),
    isCreating: flag("isCreating"),
  };
}

/** Whether a path is absolute and already in normal form: no `.`/`..` segments, repeated or trailing slashes, or control characters. */
function isNormalizedAbsolute(candidate: string): boolean {
  return (
    path.posix.isAbsolute(candidate) &&
    path.posix.normalize(candidate) === candidate &&
    (candidate === "/" || !candidate.endsWith("/")) &&
    !/[\u0000-\u001f\u007f]/.test(candidate)
  );
}
