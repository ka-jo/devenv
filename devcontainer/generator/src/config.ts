import path from "node:path";
import type { GeneratorContext } from "./context.ts";
import { GeneratorError } from "./errors.ts";

/** A parsed `devcontainer.json` (JSONC resolved, variables substituted), as `read-configuration` returns it. */
export type DevcontainerConfig = Readonly<Record<string, unknown>>;

/** The `devcontainer.json` the CLI actually runs from. */
export type GeneratedConfig = DevcontainerConfig & {
  /** The compose service the dev container is. */
  readonly service: string;
};

/** A source config as the devcontainer CLI resolves it. */
export interface ResolvedSourceConfig {
  /** The config as written (JSONC and `${...}` variables resolved). */
  readonly configuration: DevcontainerConfig;
  /**
   * The config plus everything its Features (and an already-built image's metadata label) contribute; only resolved
   * when asked for, otherwise the config itself.
   */
  readonly merged: DevcontainerConfig;
}

/** The per-worktree values {@link deriveGeneratedConfig} writes into a source config. */
export interface GeneratedConfigInputs {
  /** Directory of the source `devcontainer.json`, which its relative compose paths resolve against. */
  readonly sourceDir: string;
  /** Host path of the generated compose override, appended as the last compose file. */
  readonly overridePath: string;
  /** Container path of the worktree. */
  readonly workspaceFolder: string;
  /** Whether the source is devenv's own default config rather than a project's. */
  readonly isDefault: boolean;
}

/** A derived config plus what was changed in the source, for reporting to the user. */
export interface DerivedConfig {
  /** The config the CLI runs from. */
  readonly config: GeneratedConfig;
  /** Absolute paths of the source's compose files, in merge order. */
  readonly composeFiles: readonly string[];
  /** One line per change made to the project's own config. */
  readonly notices: readonly string[];
}

/** Where devenv's own Features go inside the generated `.devcontainer/`, apart from any of the project's. */
export const DEVENV_FEATURES_SUBDIR = ".devenv-features";

/**
 * Parses a `devcontainer.json` through the devcontainer CLI's `read-configuration`, so JSONC and `${...}` variables
 * resolve exactly as the CLI itself will resolve them — against the worktree.
 *
 * @param context - Supplies the CLI path and the worktree.
 * @param configPath - The `devcontainer.json` to read.
 * @param shouldMerge - Whether to also resolve what its Features contribute. That resolution only accepts local
 * Features under the worktree's `.devcontainer/`, so it fails for devenv's default config — which needs no merged view,
 * as it's never validated.
 * @returns The config, and the config merged with what its Features contribute.
 * @throws {@link GeneratorError} when the CLI can't read it.
 */
export async function readSourceConfig(
  context: GeneratorContext,
  configPath: string,
  shouldMerge: boolean,
): Promise<ResolvedSourceConfig> {
  const proc = Bun.spawn(
    [
      context.devcontainerCli,
      "read-configuration",
      "--workspace-folder",
      context.worktreePath,
      "--config",
      configPath,
      ...(shouldMerge ? ["--include-merged-configuration"] : []),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    // The CLI logs its whole progress to stderr; only its error lines say what went wrong.
    const errorLines = errors.split("\n").filter((line) => /\bError\b|\bERR\b/.test(line));
    const reason = (errorLines.length > 0 ? errorLines : errors.trim().split("\n").slice(-1)).join("\n");
    throw new GeneratorError(`couldn't read ${configPath}: ${reason.replace(/^\[[^\]]*\]\s*/gm, "")}`);
  }

  const parsed: unknown = JSON.parse(output);
  const configuration = objectField(parsed, "configuration");
  const merged = shouldMerge ? objectField(parsed, "mergedConfiguration") : configuration;
  if (configuration === undefined || merged === undefined) {
    throw new GeneratorError(`read-configuration returned no configuration for ${configPath}`);
  }
  return { configuration, merged };
}

/**
 * Turns a source config into the one the CLI runs from: the per-worktree fields no devcontainer variable can
 * express, plus the agent Feature every devenv container gets.
 *
 * @param source - The parsed source config. Must be compose-based.
 * @param inputs - The per-worktree values to write in.
 * @returns The generated config; `source` is not modified.
 * @throws {@link GeneratorError} when `source` isn't a compose-based config.
 */
export function deriveGeneratedConfig(source: DevcontainerConfig, inputs: GeneratedConfigInputs): DerivedConfig {
  const { service, dockerComposeFile } = source;
  if (typeof service !== "string" || dockerComposeFile === undefined) {
    throw new GeneratorError("only compose-based dev container configs (dockerComposeFile + service) are supported");
  }
  const composeFiles = typeof dockerComposeFile === "string" ? [dockerComposeFile] : dockerComposeFile;
  if (!Array.isArray(composeFiles) || !composeFiles.every((file): file is string => typeof file === "string")) {
    throw new GeneratorError("dockerComposeFile must be a path or a list of paths");
  }
  const absoluteComposeFiles = composeFiles.map((file) => path.resolve(inputs.sourceDir, file));

  const notices: string[] = [];
  // read-configuration adds configFilePath; it isn't part of the devcontainer.json schema. initializeCommand runs on
  // the HOST, so a project's would be host code execution from an agent-writable file.
  const { configFilePath: _, initializeCommand, ...config } = source;
  if (initializeCommand !== undefined && !inputs.isDefault) {
    notices.push("initializeCommand removed (it would run on the host)");
  }
  if (!inputs.isDefault && typeof source.workspaceFolder === "string" && source.workspaceFolder !== inputs.workspaceFolder) {
    notices.push(`workspaceFolder changed from ${source.workspaceFolder} to ${inputs.workspaceFolder}`);
  }
  const features = typeof source.features === "object" && source.features !== null ? source.features : {};

  return {
    config: {
      ...config,
      ...(inputs.isDefault && initializeCommand !== undefined ? { initializeCommand } : {}),
      service,
      // Absolute because the generated file doesn't live beside them; the override goes last so it wins.
      dockerComposeFile: [...absoluteComposeFiles, inputs.overridePath],
      workspaceFolder: inputs.workspaceFolder,
      features: { ...features, [`./${DEVENV_FEATURES_SUBDIR}/agent`]: {} },
      // A project image's user rarely has the host user's UID, which every read-write bind mount needs.
      ...(inputs.isDefault ? {} : { updateRemoteUserUID: true }),
    },
    composeFiles: absoluteComposeFiles,
    notices,
  };
}

/**
 * Lists the local Features (`./<path>` keys) a config uses, as paths relative to its directory.
 *
 * @param source - The parsed source config.
 * @returns Relative paths, e.g. `features/foo`.
 * @throws {@link GeneratorError} when a path leaves the config's directory, which the CLI wouldn't accept either.
 */
export function localFeaturePaths(source: DevcontainerConfig): string[] {
  const features = typeof source.features === "object" && source.features !== null ? Object.keys(source.features) : [];
  return features
    .filter((id) => id.startsWith("./") || id.startsWith("../"))
    .map((id) => {
      const relative = path.posix.normalize(id);
      if (relative.startsWith("..")) {
        throw new GeneratorError(`local Feature ${id} is outside the config's directory`);
      }
      return relative;
    });
}

function objectField(value: unknown, key: string): DevcontainerConfig | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  const field: unknown = Reflect.get(value, key);
  return typeof field === "object" && field !== null ? { ...field } : undefined;
}
