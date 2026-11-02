import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { GeneratorContext } from "./context.ts";
import { GeneratorError } from "./errors.ts";

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

/**
 * Picks the config for a worktree: the project's own `.devcontainer/devcontainer.json` or `.devcontainer.json` when it
 * has one (unless {@link GeneratorContext.shouldForceDefault}), otherwise devenv's default.
 *
 * @param context - Supplies the worktree, the default config, and whether to force it.
 * @returns The chosen config.
 * @throws {@link GeneratorError} when the project only has configs in `.devcontainer/<name>/` subfolders, which need
 * picking explicitly.
 */
export function resolveSourceConfig(context: GeneratorContext): SourceConfig {
  const defaultConfig = sourceConfigAt(context.defaultConfig);
  if (context.shouldForceDefault) {
    return defaultConfig;
  }

  const folderDir = path.join(context.worktreePath, ".devcontainer");
  for (const candidate of [path.join(folderDir, "devcontainer.json"), path.join(context.worktreePath, ".devcontainer.json")]) {
    if (existsSync(candidate)) {
      return sourceConfigAt(candidate);
    }
  }

  const subfolderConfigs = existsSync(folderDir)
    ? readdirSync(folderDir).filter((entry) =>
        statSync(path.join(folderDir, entry, "devcontainer.json"), { throwIfNoEntry: false })?.isFile(),
      )
    : [];
  if (subfolderConfigs.length > 0) {
    throw new GeneratorError(
      `${context.worktreePath} only has dev container configs in .devcontainer/ subfolders ` +
        `(${subfolderConfigs.join(", ")}), which devenv doesn't pick between yet; ` +
        "add .devcontainer/devcontainer.json, or pass --default to use devenv's default config",
    );
  }
  return defaultConfig;
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
