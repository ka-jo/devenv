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

/** The per-worktree values {@link deriveGeneratedConfig} writes into a source config. */
export interface GeneratedConfigInputs {
  /** Directory of the source `devcontainer.json`, which its relative compose paths resolve against. */
  readonly sourceDir: string;
  /** Host path of the generated compose override, appended as the last compose file. */
  readonly overridePath: string;
  /** Container path of the worktree. */
  readonly workspaceFolder: string;
}

/**
 * Parses a `devcontainer.json` through the devcontainer CLI's `read-configuration`, so JSONC and `${...}` variables
 * resolve exactly as the CLI itself will resolve them — against the worktree.
 *
 * @param context - Supplies the CLI path and the worktree.
 * @param configPath - The `devcontainer.json` to read.
 * @returns The parsed config.
 * @throws {@link GeneratorError} when the CLI can't read it.
 */
export async function readSourceConfig(context: GeneratorContext, configPath: string): Promise<DevcontainerConfig> {
  const proc = Bun.spawn(
    [context.devcontainerCli, "read-configuration", "--workspace-folder", context.worktreePath, "--config", configPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new GeneratorError(`couldn't read ${configPath}:\n${errors.trim()}`);
  }

  const parsed: unknown = JSON.parse(output);
  const configuration =
    typeof parsed === "object" && parsed !== null && "configuration" in parsed ? parsed.configuration : undefined;
  if (typeof configuration !== "object" || configuration === null) {
    throw new GeneratorError(`read-configuration returned no configuration for ${configPath}`);
  }
  return { ...configuration };
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
export function deriveGeneratedConfig(source: DevcontainerConfig, inputs: GeneratedConfigInputs): GeneratedConfig {
  const { service, dockerComposeFile } = source;
  if (typeof service !== "string" || dockerComposeFile === undefined) {
    throw new GeneratorError("only compose-based dev container configs (dockerComposeFile + service) are supported");
  }
  const composeFiles = typeof dockerComposeFile === "string" ? [dockerComposeFile] : dockerComposeFile;
  if (!Array.isArray(composeFiles) || !composeFiles.every((file): file is string => typeof file === "string")) {
    throw new GeneratorError("dockerComposeFile must be a path or a list of paths");
  }

  // read-configuration adds this; it isn't part of the devcontainer.json schema.
  const { configFilePath: _, ...config } = source;
  const features = typeof source.features === "object" && source.features !== null ? source.features : {};
  return {
    ...config,
    service,
    // Absolute because the generated file doesn't live beside them; the override goes last so it wins.
    dockerComposeFile: [...composeFiles.map((file) => path.resolve(inputs.sourceDir, file)), inputs.overridePath],
    workspaceFolder: inputs.workspaceFolder,
    features: { ...features, "./features/agent": {} },
  };
}
