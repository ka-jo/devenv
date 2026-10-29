import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ComposeModel } from "./compose.ts";
import type { SourceConfig } from "./source.ts";

/** Every file a project config is built from, as read at one moment. */
export interface ConfigSet {
  /** File contents keyed by path relative to the worktree, sorted. */
  readonly files: ReadonlyMap<string, Buffer>;
  /** Hash identifying exactly these paths and contents. */
  readonly hash: string;
}

/**
 * Reads every file a project config is built from: its whole `.devcontainer/` folder (or its lone
 * `.devcontainer.json`), its compose files, and the Dockerfiles those reference.
 *
 * @param worktreePath - Host path of the worktree; every file must be inside it (validation guarantees this).
 * @param source - The project's config.
 * @param composeFiles - Absolute paths of its compose files.
 * @param model - Its normalized compose model, for build Dockerfiles.
 * @returns The files and their hash.
 *
 * @remarks
 * Approval covers these files only. Build contexts (what Dockerfiles `COPY`) and images pulled by tag aren't part of
 * it.
 */
export function collectConfigSet(
  worktreePath: string,
  source: SourceConfig,
  composeFiles: readonly string[],
  model: ComposeModel,
): ConfigSet {
  const paths = new Set<string>(
    path.basename(source.configDir) === ".devcontainer" ? listFiles(source.configDir) : [source.configPath],
  );
  for (const file of composeFiles) {
    paths.add(file);
  }
  for (const service of Object.values(model.services)) {
    if (service.build?.context !== undefined) {
      paths.add(path.resolve(service.build.context, service.build.dockerfile ?? "Dockerfile"));
    }
  }

  const files = new Map<string, Buffer>();
  for (const file of [...paths].map((absolute) => path.relative(worktreePath, absolute)).sort()) {
    const absolute = path.join(worktreePath, file);
    if (existsSync(absolute)) {
      files.set(file, readFileSync(absolute));
    }
  }
  return { files, hash: hashFiles(files) };
}

/**
 * Whether a config set was approved for a repo — by any worktree of it, since approval is per content.
 *
 * @param trustDir - The host-only approvals directory.
 * @param repo - The repo name.
 * @param hash - The config set's hash.
 * @returns `true` when exactly this content was approved.
 */
export function isConfigSetApproved(trustDir: string, repo: string, hash: string): boolean {
  return existsSync(path.join(trustDir, repo, hash));
}

/**
 * Records approval of a config set: a snapshot of exactly these contents, which also serves as the base for diffing
 * the repo's next config change.
 *
 * @param trustDir - The host-only approvals directory.
 * @param repo - The repo name.
 * @param configSet - The set the user reviewed. Written from memory, never re-read, so what's approved is exactly what
 * was shown.
 */
export function approveConfigSet(trustDir: string, repo: string, configSet: ConfigSet): void {
  writeSnapshot(path.join(trustDir, repo, configSet.hash), configSet);
  writeFileSync(path.join(trustDir, repo, "latest"), `${configSet.hash}\n`);
}

/**
 * The snapshot directory of the repo's most recent approval, if any.
 *
 * @param trustDir - The host-only approvals directory.
 * @param repo - The repo name.
 * @returns The snapshot path, or `undefined` before the repo's first approval.
 */
export function latestApprovedSnapshot(trustDir: string, repo: string): string | undefined {
  const latest = path.join(trustDir, repo, "latest");
  if (!existsSync(latest)) {
    return undefined;
  }
  const snapshot = path.join(trustDir, repo, readFileSync(latest, "utf8").trim());
  return existsSync(snapshot) ? snapshot : undefined;
}

/**
 * Writes a config set's files under a directory, at their worktree-relative paths.
 *
 * @param dir - Destination; created if missing.
 * @param configSet - The files to write.
 */
export function writeSnapshot(dir: string, configSet: ConfigSet): void {
  for (const [file, content] of configSet.files) {
    const destination = path.join(dir, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  mkdirSync(dir, { recursive: true });
}

/** Every file under a directory, recursively, as absolute paths. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Hash over each path and its content, so renames and moves change it as well as edits. */
function hashFiles(files: ReadonlyMap<string, Buffer>): string {
  const hash = createHash("sha256");
  for (const [file, content] of files) {
    hash.update(file).update("\0").update(content).update("\0");
  }
  return hash.digest("hex");
}
