import { GeneratorError } from "./errors.ts";

/**
 * Everything the generator needs to know about one worktree and the host, as
 * supplied by `lib/container.sh` (which owns these values) on stdin.
 */
export interface GeneratorContext {
  /** Host path of the devenv repo, `~/devenv`. */
  readonly repoDir: string;
  /** Host directory holding every repo's bare clone and worktrees, `~/devenv/worktrees`. */
  readonly worktreesDir: string;
  /** Repo name, the `<repo>` in `worktrees/<repo>/<branch>`. */
  readonly repo: string;
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
  /** Where {@link GeneratorContext.repoDir} is mounted inside the container. */
  readonly containerRepoDir: string;
  /** Claude Code's `CLAUDE_CONFIG_DIR` inside the container. */
  readonly containerClaudeDir: string;
  /** Docker name of the shared stack's internal proxy network. */
  readonly proxyNetwork: string;
  /** The default `devcontainer.json`, used when the project has none. */
  readonly defaultConfig: string;
  /** devenv's local Features directory. */
  readonly featuresDir: string;
  /** Path of the pinned devcontainer CLI executable. */
  readonly devcontainerCli: string;
}

/**
 * Parses the JSON context `lib/container.sh` sends, checking every {@link GeneratorContext} field is a non-empty
 * string.
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

  return {
    repoDir: field("repoDir"),
    worktreesDir: field("worktreesDir"),
    repo: field("repo"),
    worktreePath: field("worktreePath"),
    projectName: field("projectName"),
    home: field("home"),
    stateDir: field("stateDir"),
    claudeDataDir: field("claudeDataDir"),
    containerRepoDir: field("containerRepoDir"),
    containerClaudeDir: field("containerClaudeDir"),
    proxyNetwork: field("proxyNetwork"),
    defaultConfig: field("defaultConfig"),
    featuresDir: field("featuresDir"),
    devcontainerCli: field("devcontainerCli"),
  };
}
