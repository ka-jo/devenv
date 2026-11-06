import { createHash, type Hash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEVENV_FEATURES_SUBDIR, type GeneratedConfig } from "./config.ts";
import type { GeneratorContext } from "./context.ts";
import { GeneratorError } from "./errors.ts";
import { resolveWorktreeGitLayout } from "./git.ts";
import { buildOverride, renderOverride } from "./override.ts";
import { formatViolations, formatWarnings, generatedDirOf, loadWorktreeConfig, overridePathOf } from "./project.ts";
import { withDevenvRecord } from "./record.ts";
import { isConfigSetApproved } from "./trust.ts";

/** What {@link generateWorktreeConfig} reports back to `lib/container.sh`. */
export interface GenerateResult {
  /** The compose service the agent layer was applied to. */
  readonly service: string;
  /** One line per automatic change made to the config. */
  readonly notices: readonly string[];
  /**
   * Ways the config may expose host files, plus problems that would block creating a container, reported instead
   * because one already exists.
   */
  readonly warnings: readonly string[];
  /** Identifies everything a container would be created from, so `up` can tell when an existing one is stale. */
  readonly inputsHash: string;
  /** The {@link GenerateResult.inputsHash} the existing container was created from, when recorded. */
  readonly createdHash?: string;
}

/**
 * Writes the generated `devcontainer.json`, its local Features, and the compose override for one worktree into
 * {@link GeneratorContext.stateDir} — after checking the config against devenv's sandbox rules and its approval.
 *
 * @param context - The worktree and host description from `lib/container.sh`.
 * @returns What was generated, changed, and found.
 * @throws {@link GeneratorError} when the config can't be used, or — when {@link GeneratorContext.isCreating} — breaks
 * a sandbox rule or hasn't been approved.
 */
export async function generateWorktreeConfig(context: GeneratorContext): Promise<GenerateResult> {
  const { name, record, derived, model, violations, warnings, isMergedChecked, configSet } = await loadWorktreeConfig(
    context,
    context.stateDir,
  );

  const blockers = formatViolations(violations, isMergedChecked);
  if (!isConfigSetApproved(context.trustDir, configSet.hash)) {
    blockers.push(
      `the dev container config ${name} hasn't been approved in this form (new, or changed since last approved); ` +
        `review it with: devenv container trust ${context.repo} ${context.branch}`,
    );
  }
  if (blockers.length > 0 && context.isCreating) {
    throw new GeneratorError(blockers.join("\n"));
  }

  // loadWorktreeConfig staged everything but the override, which can only be built from the validated model.
  const devcontainerDir = generatedDirOf(context.stateDir);
  writeFileSync(path.join(devcontainerDir, "devcontainer.json"), `${JSON.stringify(withDevenvRecord(derived.config, record), null, 2)}\n`);
  const git = resolveWorktreeGitLayout(context);
  // Pinned read-only by the override, so it has to exist as a mount source.
  mkdirSync(path.join(git.bare, "hooks"), { recursive: true });
  const { override, notices } = buildOverride(context, model, derived.config.service, git);
  writeFileSync(overridePathOf(context), renderOverride(override));

  return {
    service: derived.config.service,
    notices: [...derived.notices, ...notices],
    warnings: [...formatWarnings(warnings), ...blockers],
    inputsHash: hashInputs(derived.config, devcontainerDir, context.featuresDir, overridePathOf(context), configSet.hash),
    ...(record.createdHash !== undefined ? { createdHash: record.createdHash } : {}),
  };
}

/**
 * Hash of the generated config (without devenv's record, which holds this hash), its local Features, devenv's
 * Features, the override, and the config set's hash. Changes in a build context outside the config's folder aren't
 * detected.
 */
function hashInputs(
  config: GeneratedConfig,
  devcontainerDir: string,
  featuresDir: string,
  overridePath: string,
  sourceHash: string,
): string {
  const hash = createHash("sha256").update(sourceHash).update("\0").update(readFileSync(overridePath));
  hash.update("\0").update(JSON.stringify(config));
  // A recursive readdir doesn't descend into the linked devenv Features, so they're hashed from their source.
  updateWithTree(hash, devcontainerDir, "");
  updateWithTree(hash, featuresDir, DEVENV_FEATURES_SUBDIR);
  return hash.digest("hex");
}

/**
 * Feeds every regular file under a directory into a hash, by its path (under a prefix) and content, in sorted order —
 * except the CLI's lockfile, and a top-level `devcontainer.json`, which {@link hashInputs} hashes without devenv's
 * record.
 */
function updateWithTree(hash: Hash, dir: string, prefix: string): void {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "devcontainer-lock.json")
    .filter((entry) => !(entry.parentPath === dir && entry.name === "devcontainer.json"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  for (const file of files) {
    hash.update("\0").update(path.join(prefix, path.relative(dir, file))).update("\0").update(readFileSync(file));
  }
}
