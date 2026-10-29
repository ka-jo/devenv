import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deriveGeneratedConfig, readSourceConfig } from "./config.ts";
import type { GeneratorContext } from "./context.ts";
import type { GeneratorError } from "./errors.ts";
import { resolveWorktreeGitLayout } from "./git.ts";
import { buildOverride, renderOverride } from "./override.ts";
import { containerPathOf } from "./paths.ts";

/** What {@link generateWorktreeConfig} reports back to `lib/container.sh`. */
export interface GenerateResult {
  /** The compose service the agent layer was applied to. */
  readonly service: string;
}

/**
 * Writes the generated `devcontainer.json`, its local Features, and the compose override for one worktree into
 * {@link GeneratorContext.stateDir}.
 *
 * @param context - The worktree and host description from `lib/container.sh`.
 * @returns What was generated.
 * @throws {@link GeneratorError} when the worktree or its source config can't be used.
 */
export async function generateWorktreeConfig(context: GeneratorContext): Promise<GenerateResult> {
  const devcontainerDir = path.join(context.stateDir, ".devcontainer");
  const overridePath = path.join(context.stateDir, "override.yaml");
  mkdirSync(devcontainerDir, { recursive: true });

  const source = await readSourceConfig(context, context.defaultConfig);
  const generated = deriveGeneratedConfig(source, {
    sourceDir: path.dirname(context.defaultConfig),
    overridePath,
    workspaceFolder: containerPathOf(context, context.worktreePath),
  });
  writeFileSync(path.join(devcontainerDir, "devcontainer.json"), `${JSON.stringify(generated, null, 2)}\n`);

  // The CLI resolves local Features ("./features/<id>") relative to the config file and only accepts them under
  // <workspace-folder>/.devcontainer/ (lib/container.sh's _devcontainer passes stateDir as the workspace folder).
  const featuresCopy = path.join(devcontainerDir, "features");
  rmSync(featuresCopy, { recursive: true, force: true });
  cpSync(context.featuresDir, featuresCopy, { recursive: true });

  const git = resolveWorktreeGitLayout(context);
  // Pinned read-only by the override, so it has to exist as a mount source.
  mkdirSync(path.join(git.bare, "hooks"), { recursive: true });
  writeFileSync(overridePath, renderOverride(buildOverride(context, generated.service, git)));

  return { service: generated.service };
}
