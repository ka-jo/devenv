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
   * Whether it's devenv's own default config — trusted as-is, since it lives in the read-only `~/devenv` — rather than
   * a project's, which lives in the agent-writable worktree.
   */
  readonly isDefault: boolean;
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
  const defaultConfig: SourceConfig = {
    configPath: context.defaultConfig,
    configDir: path.dirname(context.defaultConfig),
    isDefault: true,
  };
  if (context.shouldForceDefault) {
    return defaultConfig;
  }

  const folderDir = path.join(context.worktreePath, ".devcontainer");
  for (const candidate of [path.join(folderDir, "devcontainer.json"), path.join(context.worktreePath, ".devcontainer.json")]) {
    if (existsSync(candidate)) {
      return { configPath: candidate, configDir: path.dirname(candidate), isDefault: false };
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
