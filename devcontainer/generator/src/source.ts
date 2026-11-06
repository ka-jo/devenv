import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { GeneratorContext } from "./context.ts";
import { GeneratorError } from "./errors.ts";
import type { DevenvRecord } from "./record.ts";

/** The `devcontainer.json` a worktree's container is built from. */
export interface SourceConfig {
  /** Path of the `devcontainer.json` itself. */
  readonly configPath: string;
  /** Directory its relative paths (compose files, local Features) resolve against. */
  readonly configDir: string;
  /**
   * The folder the config belongs to: the one holding its `.devcontainer/` folder, otherwise
   * {@link SourceConfig.configDir}. Approved file paths are relative to it, and host paths inside it aren't flagged.
   */
  readonly rootDir: string;
}

// Where a folder keeps its config, in the order they're preferred: the spec's two locations, then a plain
// devcontainer.json for a folder that's only a config.
const FOLDER_CONFIGS = [path.join(".devcontainer", "devcontainer.json"), ".devcontainer.json"] as const;
const CONFIG_FOLDER_CONFIGS = [...FOLDER_CONFIGS, "devcontainer.json"] as const;

/**
 * Picks the config for a worktree, first match wins: {@link GeneratorContext.configPath}, the config it last used, its
 * own `.devcontainer/devcontainer.json` or `.devcontainer.json`, then devenv's default.
 *
 * @param context - Supplies the requested config, the worktree, and the default.
 * @param record - What the worktree's previous run recorded.
 * @returns The chosen config.
 * @throws {@link GeneratorError} when the requested or last-used config doesn't exist, or the worktree only has
 * configs in `.devcontainer/<name>/` subfolders, which need picking explicitly.
 */
export function resolveSourceConfig(context: GeneratorContext, record: DevenvRecord): SourceConfig {
  if (context.configPath !== undefined) {
    return sourceConfigAt(requestedConfigPath(context.configPath));
  }
  if (record.sourceConfig !== undefined) {
    if (!existsSync(record.sourceConfig)) {
      throw new GeneratorError(
        `the config this worktree last used, ${record.sourceConfig}, no longer exists; pick one with --config <path>`,
      );
    }
    return sourceConfigAt(record.sourceConfig);
  }

  const own = FOLDER_CONFIGS.map((file) => path.join(context.worktreePath, file)).find((file) => existsSync(file));
  if (own !== undefined) {
    return sourceConfigAt(own);
  }
  const folderDir = path.join(context.worktreePath, ".devcontainer");
  const subfolderConfigs = existsSync(folderDir)
    ? readdirSync(folderDir).filter((entry) =>
        statSync(path.join(folderDir, entry, "devcontainer.json"), { throwIfNoEntry: false })?.isFile(),
      )
    : [];
  if (subfolderConfigs.length > 0) {
    throw new GeneratorError(
      `${context.worktreePath} only has dev container configs in .devcontainer/ subfolders ` +
        `(${subfolderConfigs.join(", ")}), which devenv doesn't pick between; ` +
        "pick one with --config <path>",
    );
  }
  return sourceConfigAt(context.defaultConfig);
}

/** A requested config file as given, or the config file a requested folder holds. */
function requestedConfigPath(requested: string): string {
  const stats = statSync(requested, { throwIfNoEntry: false });
  if (stats?.isFile() === true) {
    return requested;
  }
  if (stats?.isDirectory() === true) {
    const found = CONFIG_FOLDER_CONFIGS.map((file) => path.join(requested, file)).find((file) => existsSync(file));
    if (found !== undefined) {
      return found;
    }
    throw new GeneratorError(`${requested} has no dev container config (looked for ${CONFIG_FOLDER_CONFIGS.join(", ")})`);
  }
  throw new GeneratorError(`${requested} doesn't exist`);
}

/** Describes the config at a path. */
function sourceConfigAt(configPath: string): SourceConfig {
  const configDir = path.dirname(configPath);
  return {
    configPath,
    configDir,
    rootDir: path.basename(configDir) === ".devcontainer" ? path.dirname(configDir) : configDir,
  };
}
