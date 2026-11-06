import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type ComposeModel, loadComposeModel } from "./compose.ts";
import {
  DEVENV_FEATURES_SUBDIR,
  type DerivedConfig,
  deriveGeneratedConfig,
  type GeneratedConfig,
  localFeaturePaths,
  readSourceConfig,
  type ResolvedSourceConfig,
} from "./config.ts";
import type { GeneratorContext } from "./context.ts";
import { containerPathOf } from "./paths.ts";
import { type DevenvRecord, readDevenvRecord, withDevenvRecord } from "./record.ts";
import { resolveSourceConfig, type SourceConfig } from "./source.ts";
import { collectConfigSet, configNameOf, type ConfigSet } from "./trust.ts";
import { isSandboxEscape, type Violation, validateConfigFolder, validateMergedConfig, validateProjectConfig } from "./validate.ts";

/** A worktree's config, fully resolved and checked. */
export interface LoadedConfig {
  /** Which config it is. */
  readonly source: SourceConfig;
  /** Its name, for finding its previous approval. */
  readonly name: string;
  /** What to record in the generated config: this config, and the existing container's created hash. */
  readonly record: DevenvRecord;
  /** The config as the devcontainer CLI resolves it. */
  readonly resolved: ResolvedSourceConfig;
  /** The config the CLI will run from. */
  readonly derived: DerivedConfig;
  /** Its normalized compose model, without devenv's override. */
  readonly model: ComposeModel;
  /** Ways out of the sandbox it opens; any one blocks it. */
  readonly violations: readonly Violation[];
  /** Ways it may expose host files to the container, for whoever approves or runs it to weigh. */
  readonly warnings: readonly Violation[];
  /**
   * Whether what Features and the base image add was checked too. It's only resolved once the config itself opens no
   * way out of the sandbox, so it's `false` when {@link LoadedConfig.violations} are from the config itself.
   */
  readonly isMergedChecked: boolean;
  /** Its files, for approval. */
  readonly configSet: ConfigSet;
}

/** Where the generator writes the compose override for a worktree. */
export function overridePathOf(context: GeneratorContext): string {
  return path.join(context.stateDir, "override.yaml");
}

/**
 * Where a staging directory's generated `devcontainer.json` and the local Features it uses live.
 *
 * @param stageDir - The directory passed to {@link loadWorktreeConfig}.
 * @returns `<stageDir>/.devcontainer`.
 */
export function generatedDirOf(stageDir: string): string {
  return path.join(stageDir, ".devcontainer");
}

/**
 * Resolves a worktree's config, validates it, and reads the files approval covers.
 *
 * @param context - The worktree and host description.
 * @param stageDir - A host-only directory to stage the generated `.devcontainer/` in (see {@link generatedDirOf}),
 * which resolving what Features add requires. Its `.devcontainer/` is replaced, its `devcontainer.json` carrying the
 * new {@link LoadedConfig.record}.
 * @returns Everything needed to generate from the config or to review it.
 * @throws {@link GeneratorError} when the config can't be read or isn't compose-based.
 *
 * @remarks
 * The staged `devcontainer.json` lacks devenv's compose override, which the caller adds once it's written.
 */
export async function loadWorktreeConfig(context: GeneratorContext, stageDir: string): Promise<LoadedConfig> {
  // Read before staging: when stageDir is the state dir, staging replaces the file it's read from.
  const previous = readDevenvRecord(path.join(generatedDirOf(context.stateDir), "devcontainer.json"));
  const source = resolveSourceConfig(context, previous);
  const record: DevenvRecord = {
    sourceConfig: source.configPath,
    ...(previous.createdHash !== undefined ? { createdHash: previous.createdHash } : {}),
  };
  const resolved = await readSourceConfig(context, context.worktreePath, source.configPath, false);
  const derived = deriveGeneratedConfig(resolved.configuration, {
    sourceDir: source.configDir,
    overridePath: overridePathOf(context),
    workspaceFolder: containerPathOf(context, context.worktreePath),
  });
  const model = await loadComposeModel(derived.composeFiles);
  const configSet = collectConfigSet(source, resolved.configuration, derived.composeFiles, model, context.home);
  const allowedRoots = [context.worktreePath, source.rootDir];
  const found = [
    ...validateConfigFolder(source.rootDir, context.home),
    ...validateProjectConfig({
      model,
      primaryService: derived.config.service,
      devcontainerConfig: resolved.configuration,
      composeFiles: derived.composeFiles,
      rawComposeFiles: derived.composeFiles.map((file) => ({ path: file, text: readFileSync(file, "utf8") })),
      allowedRoots,
    }),
  ];
  const stagedConfig = withDevenvRecord({ ...derived.config, dockerComposeFile: derived.composeFiles }, record);
  stageGeneratedConfig(context, source, resolved, stagedConfig, stageDir);
  const loaded = { source, name: configNameOf(context, source), record, derived, model, configSet };
  if (found.some((violation) => isSandboxEscape(violation.rule))) {
    return { ...loaded, resolved, ...splitViolations(found), isMergedChecked: false };
  }

  // Only now: resolving Features and the base image makes the CLI read the config's Dockerfiles and pull its base
  // image. It reads the staged copy, since it only resolves local Features under <workspace-folder>/.devcontainer/.
  const staged = await readSourceConfig(context, stageDir, path.join(generatedDirOf(stageDir), "devcontainer.json"), true);
  return {
    ...loaded,
    resolved: { configuration: resolved.configuration, merged: staged.merged },
    ...splitViolations([...found, ...validateMergedConfig(staged.merged, allowedRoots)]),
    isMergedChecked: true,
  };
}

/**
 * Writes a generated config into a staging directory's `.devcontainer/`, beside copies of the config's own local
 * Features and a link to devenv's.
 */
function stageGeneratedConfig(
  context: GeneratorContext,
  source: SourceConfig,
  resolved: ResolvedSourceConfig,
  config: GeneratedConfig,
  stageDir: string,
): void {
  const devcontainerDir = generatedDirOf(stageDir);
  rmSync(devcontainerDir, { recursive: true, force: true });
  mkdirSync(devcontainerDir, { recursive: true });
  writeFileSync(path.join(devcontainerDir, "devcontainer.json"), `${JSON.stringify(config, null, 2)}\n`);
  // The CLI resolves local Features ("./<path>") relative to the config file and only accepts them under
  // <workspace-folder>/.devcontainer/, so the config's own are copied beside it at the same relative paths, and
  // devenv's linked in as their own subdir. That check is on the path as written, so the link passes it. The config's
  // are copied rather than linked: a link could point back into the agent-writable worktree.
  for (const feature of localFeaturePaths(resolved.configuration)) {
    cpSync(path.join(source.configDir, feature), path.join(devcontainerDir, feature), { recursive: true });
  }
  symlinkSync(context.featuresDir, path.join(devcontainerDir, DEVENV_FEATURES_SUBDIR));
}

function splitViolations(found: readonly Violation[]): Pick<LoadedConfig, "violations" | "warnings"> {
  return {
    violations: found.filter((violation) => isSandboxEscape(violation.rule)),
    warnings: found.filter((violation) => !isSandboxEscape(violation.rule)),
  };
}

/**
 * Formats sandbox escapes as user-facing lines, ending with where to read about them.
 *
 * @param violations - The escapes to report.
 * @param isMergedChecked - Whether what Features and the base image add was checked; when not, says so.
 * @returns The lines; empty when there are none.
 */
export function formatViolations(violations: readonly Violation[], isMergedChecked: boolean): string[] {
  if (violations.length === 0) {
    return [];
  }
  return [
    "the dev container config breaks devenv's sandbox rules:",
    ...violations.map(formatViolation),
    ...(isMergedChecked ? [] : ["  (what its Features and base image add is checked once these are fixed)"]),
    "  see docs/agent-container-security.md (sections named by the [rule]), or pick another config with --config <path>",
  ];
}

function formatViolation(violation: Violation): string {
  return `  - ${violation.location}: ${violation.detail} [${violation.rule}]`;
}

/**
 * Formats host-exposure warnings as user-facing lines, one per warning.
 *
 * @param warnings - The warnings to report.
 * @returns The lines; empty when there are none.
 */
export function formatWarnings(warnings: readonly Violation[]): string[] {
  return warnings.map((warning) => `${warning.location}: ${warning.detail} [${warning.rule}]`);
}
