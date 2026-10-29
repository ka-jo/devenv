import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComposeModel, loadComposeModel } from "./compose.ts";
import { type DerivedConfig, deriveGeneratedConfig, readSourceConfig, type ResolvedSourceConfig } from "./config.ts";
import type { GeneratorContext } from "./context.ts";
import { containerPathOf } from "./paths.ts";
import { resolveSourceConfig, type SourceConfig } from "./source.ts";
import { collectConfigSet, type ConfigSet } from "./trust.ts";
import { type Violation, validateMergedConfig, validateProjectConfig } from "./validate.ts";

/** A worktree's config, fully resolved and — when it's a project's — checked. */
export interface LoadedConfig {
  /** Which config it is. */
  readonly source: SourceConfig;
  /** The config as the devcontainer CLI resolves it. */
  readonly resolved: ResolvedSourceConfig;
  /** The config the CLI will run from. */
  readonly derived: DerivedConfig;
  /** Its normalized compose model, without devenv's override. */
  readonly model: ComposeModel;
  /** A project config's sandbox-rule violations; always empty for the default config. */
  readonly violations: readonly Violation[];
  /**
   * Whether what Features and the base image add was checked too. It's only resolved once the config itself passes,
   * so it's `false` when {@link LoadedConfig.violations} are from the config itself.
   */
  readonly isMergedChecked: boolean;
  /** A project config's files, for approval; `undefined` for the default config, which needs none. */
  readonly configSet: ConfigSet | undefined;
}

/** Where the generator writes the compose override for a worktree. */
export function overridePathOf(context: GeneratorContext): string {
  return path.join(context.stateDir, "override.yaml");
}

/**
 * Resolves a worktree's config and, when it's a project's, validates it and reads the files approval covers.
 *
 * @param context - The worktree and host description.
 * @returns Everything needed to generate from the config or to review it.
 * @throws {@link GeneratorError} when the config can't be read or isn't compose-based.
 */
export async function loadWorktreeConfig(context: GeneratorContext): Promise<LoadedConfig> {
  const source = resolveSourceConfig(context);
  const resolved = await readSourceConfig(context, source.configPath, false);
  const derived = deriveGeneratedConfig(resolved.configuration, {
    sourceDir: source.configDir,
    overridePath: overridePathOf(context),
    workspaceFolder: containerPathOf(context, context.worktreePath),
    isDefault: source.isDefault,
  });
  const model = await loadComposeModel(derived.composeFiles);
  if (source.isDefault) {
    return { source, resolved, derived, model, violations: [], isMergedChecked: true, configSet: undefined };
  }

  const configSet = collectConfigSet(context.worktreePath, source, derived.composeFiles, model);
  const violations = validateProjectConfig({
    model,
    primaryService: derived.config.service,
    devcontainerConfig: resolved.configuration,
    composeFiles: derived.composeFiles,
    rawComposeFiles: derived.composeFiles.map((file) => ({ path: file, text: readFileSync(file, "utf8") })),
    worktreePath: context.worktreePath,
  });
  if (violations.length > 0) {
    return { source, resolved, derived, model, violations, isMergedChecked: false, configSet };
  }
  // Only now: resolving Features and the base image makes the CLI read the config's Dockerfiles, which the first pass
  // confirmed are inside the worktree.
  const merged = await readSourceConfig(context, source.configPath, true);
  return {
    source,
    resolved: merged,
    derived,
    model,
    violations: validateMergedConfig(merged.merged, context.worktreePath),
    isMergedChecked: true,
    configSet,
  };
}

/**
 * Formats violations as user-facing lines, ending with where to read about them and how to fall back.
 *
 * @param violations - The violations to report.
 * @param context - Supplies the repo and branch for the fallback command.
 * @param isMergedChecked - Whether what Features and the base image add was checked; when not, says so.
 * @returns The lines; empty when there are no violations.
 */
export function formatViolations(
  violations: readonly Violation[],
  context: GeneratorContext,
  isMergedChecked: boolean,
): string[] {
  if (violations.length === 0) {
    return [];
  }
  return [
    "the project's dev container config breaks devenv's sandbox rules:",
    ...violations.map((violation) => `  - ${violation.location}: ${violation.detail} [${violation.rule}]`),
    ...(isMergedChecked ? [] : ["  (what its Features and base image add is checked once these are fixed)"]),
    "  see docs/agent-container-security.md (sections named by the [rule]), or use devenv's default config instead: " +
      `devenv container up ${context.repo} ${context.branch} --default`,
  ];
}
