import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEVENV_FEATURES_SUBDIR, localFeaturePaths } from "./config.ts";
import type { GeneratorContext } from "./context.ts";
import { GeneratorError } from "./errors.ts";
import { resolveWorktreeGitLayout } from "./git.ts";
import { buildOverride, renderOverride } from "./override.ts";
import { formatViolations, loadWorktreeConfig, overridePathOf } from "./project.ts";
import { isConfigSetApproved } from "./trust.ts";

/** What {@link generateWorktreeConfig} reports back to `lib/container.sh`. */
export interface GenerateResult {
  /** The compose service the agent layer was applied to. */
  readonly service: string;
  /** One line per automatic change made to a project's config. */
  readonly notices: readonly string[];
  /** Problems that would block creating a container, reported instead because one already exists. */
  readonly warnings: readonly string[];
  /** Identifies everything a container would be created from, so `up` can tell when an existing one is stale. */
  readonly inputsHash: string;
}

/**
 * Writes the generated `devcontainer.json`, its local Features, and the compose override for one worktree into
 * {@link GeneratorContext.stateDir} — after checking a project's config against devenv's sandbox rules and its
 * approval.
 *
 * @param context - The worktree and host description from `lib/container.sh`.
 * @returns What was generated, changed, and found.
 * @throws {@link GeneratorError} when the config can't be used, or — when {@link GeneratorContext.isCreating} — breaks
 * a sandbox rule or hasn't been approved.
 */
export async function generateWorktreeConfig(context: GeneratorContext): Promise<GenerateResult> {
  const { source, resolved, derived, model, violations, isMergedChecked, configSet } = await loadWorktreeConfig(context);

  const blockers = [...formatViolations(violations, context, isMergedChecked)];
  if (configSet !== undefined && !isConfigSetApproved(context.trustDir, context.repo, configSet.hash)) {
    blockers.push(
      "the project's dev container config hasn't been approved in this form (new, or changed since last approved); " +
        `review it with: devenv container trust ${context.repo} ${context.branch}`,
    );
  }
  if (blockers.length > 0 && context.isCreating) {
    throw new GeneratorError(blockers.join("\n"));
  }

  const devcontainerDir = path.join(context.stateDir, ".devcontainer");
  rmSync(devcontainerDir, { recursive: true, force: true });
  mkdirSync(devcontainerDir, { recursive: true });
  writeFileSync(path.join(devcontainerDir, "devcontainer.json"), `${JSON.stringify(derived.config, null, 2)}\n`);
  // The CLI resolves local Features ("./<path>") relative to the config file and only accepts them under
  // <workspace-folder>/.devcontainer/ (lib/container.sh's _devcontainer passes stateDir as the workspace folder), so
  // the config's own are copied beside it at the same relative paths, and devenv's into their own subdir.
  for (const feature of localFeaturePaths(resolved.configuration)) {
    cpSync(path.join(source.configDir, feature), path.join(devcontainerDir, feature), { recursive: true });
  }
  cpSync(context.featuresDir, path.join(devcontainerDir, DEVENV_FEATURES_SUBDIR), { recursive: true });

  const git = resolveWorktreeGitLayout(context);
  // Pinned read-only by the override, so it has to exist as a mount source.
  mkdirSync(path.join(git.bare, "hooks"), { recursive: true });
  const { override, notices } = buildOverride(context, model, derived.config.service, git);
  writeFileSync(overridePathOf(context), renderOverride(override));

  return {
    service: derived.config.service,
    notices: [...derived.notices, ...notices],
    warnings: blockers,
    inputsHash: hashInputs(devcontainerDir, overridePathOf(context), configSet?.hash ?? hashTopLevelFiles(source.configDir)),
  };
}

/**
 * Hash of the generated config, its local Features, the override, and a hash of the source's own files — a
 * project's approved config set, or for the default config every file beside it (compose file, Dockerfile, the
 * scripts it COPYs). Changes elsewhere in a build context aren't detected.
 */
function hashInputs(devcontainerDir: string, overridePath: string, sourceHash: string): string {
  const hash = createHash("sha256").update(sourceHash).update("\0").update(readFileSync(overridePath));
  const generated = readdirSync(devcontainerDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "devcontainer-lock.json")
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  for (const file of generated) {
    hash.update("\0").update(path.relative(devcontainerDir, file)).update("\0").update(readFileSync(file));
  }
  return hash.digest("hex");
}

/** Hash of the files directly inside a directory, by name and content. */
function hashTopLevelFiles(dir: string): string {
  const hash = createHash("sha256");
  for (const entry of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(entry.name).update("\0").update(readFileSync(path.join(dir, entry.name))).update("\0");
  }
  return hash.digest("hex");
}
