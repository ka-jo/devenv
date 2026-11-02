import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ComposeModel } from "./compose.ts";
import { localFeaturePaths, type DevcontainerConfig } from "./config.ts";
import type { GeneratorContext } from "./context.ts";
import { isPathInside } from "./paths.ts";
import type { SourceConfig } from "./source.ts";

/** Every file a config is built from, as read at one moment. */
export interface ConfigSet {
  /**
   * File contents keyed by path relative to the config's folder ({@link SourceConfig.rootDir}), sorted. A file outside
   * it is keyed by its absolute path under {@link OUTSIDE_ROOT_DIR}.
   */
  readonly files: ReadonlyMap<string, Buffer>;
  /** Hash identifying exactly these paths and contents. */
  readonly hash: string;
}

/** The top-level directory a {@link ConfigSet} keys files from outside the config's folder under. */
export const OUTSIDE_ROOT_DIR = "(outside)";

// Holds one file per config name, recording the hash it was last approved at. Can't collide with a snapshot
// directory, which is named by a 64-character hex hash.
const NAMES_DIR = "names";

/**
 * Reads every file a config is built from: its compose files, the Dockerfiles those build from, its local Features,
 * and — unless it's a lone `.devcontainer.json`, or its folder holds the home directory — every other file in its
 * folder too, since its Dockerfiles and Features may use any of them.
 *
 * @param source - The config.
 * @param configuration - The config as written, for its local Features.
 * @param composeFiles - Absolute paths of its compose files.
 * @param model - Its normalized compose model, for build Dockerfiles.
 * @param home - The host user's home directory.
 * @returns The files and their hash.
 *
 * @remarks
 * Build contexts outside the config's folder (what Dockerfiles `COPY` from there) and images pulled by tag aren't
 * covered.
 */
export function collectConfigSet(
  source: SourceConfig,
  configuration: DevcontainerConfig,
  composeFiles: readonly string[],
  model: ComposeModel,
  home: string,
): ConfigSet {
  const isWholeFolder = path.basename(source.configPath) !== ".devcontainer.json" && !isPathInside(home, source.configDir);
  const paths = new Set<string>(isWholeFolder ? listFiles(source.configDir) : [source.configPath]);
  for (const feature of localFeaturePaths(configuration)) {
    for (const file of listFiles(path.join(source.configDir, feature))) {
      paths.add(file);
    }
  }
  for (const file of composeFiles) {
    paths.add(file);
  }
  for (const service of Object.values(model.services)) {
    if (service.build?.context !== undefined) {
      paths.add(path.resolve(service.build.context, service.build.dockerfile ?? "Dockerfile"));
    }
  }

  const files = new Map<string, Buffer>();
  for (const [key, absolute] of [...paths].map((file) => [snapshotKeyOf(source.rootDir, file), file] as const).sort(byKey)) {
    if (existsSync(absolute)) {
      files.set(key, readFileSync(absolute));
    }
  }
  return { files, hash: hashFiles(files) };
}

/**
 * Names a config for finding its previous approval to diff against: `<repo>:<path in the worktree>` for a config
 * inside any worktree, so every branch of a repo shares it, otherwise its absolute path.
 *
 * @param context - Supplies the worktrees directory.
 * @param source - The config.
 * @returns The name.
 */
export function configNameOf(context: GeneratorContext, source: SourceConfig): string {
  // A worktree checkout is marked by its .git file; the path alone can't say where it starts, since branch names
  // may contain slashes.
  for (let dir = source.configDir; isPathInside(dir, context.worktreesDir) && dir !== context.worktreesDir; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, ".git"))) {
      const repo = path.relative(context.worktreesDir, dir).split(path.sep)[0];
      return `${repo}:${path.relative(dir, source.configPath)}`;
    }
  }
  return source.configPath;
}

/**
 * Whether exactly this content was approved — for any config, in any worktree.
 *
 * @param trustDir - The host-only approvals directory.
 * @param hash - The config set's hash.
 * @returns `true` when approved.
 */
export function isConfigSetApproved(trustDir: string, hash: string): boolean {
  return existsSync(path.join(trustDir, hash));
}

/**
 * Records approval of a config set: a snapshot of exactly these contents, which also becomes the base for diffing
 * the named config's next change.
 *
 * @param trustDir - The host-only approvals directory.
 * @param name - The config's name, from {@link configNameOf}.
 * @param configSet - The set the user reviewed. Written from memory, never re-read, so what's approved is exactly what
 * was shown.
 */
export function approveConfigSet(trustDir: string, name: string, configSet: ConfigSet): void {
  writeSnapshot(path.join(trustDir, configSet.hash), configSet);
  mkdirSync(path.join(trustDir, NAMES_DIR), { recursive: true });
  writeFileSync(nameFileOf(trustDir, name), `${JSON.stringify({ name, hash: configSet.hash })}\n`);
}

/**
 * The snapshot directory of a config's most recent approval, if any.
 *
 * @param trustDir - The host-only approvals directory.
 * @param name - The config's name, from {@link configNameOf}.
 * @returns The snapshot path, or `undefined` before the config's first approval.
 */
export function lastApprovedSnapshot(trustDir: string, name: string): string | undefined {
  const nameFile = nameFileOf(trustDir, name);
  if (!existsSync(nameFile)) {
    return undefined;
  }
  const record: unknown = JSON.parse(readFileSync(nameFile, "utf8"));
  const hash = typeof record === "object" && record !== null && "hash" in record ? record.hash : undefined;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
    return undefined;
  }
  const snapshot = path.join(trustDir, hash);
  return existsSync(snapshot) ? snapshot : undefined;
}

/**
 * Writes a config set's files under a directory, at their {@link ConfigSet.files} keys.
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

/** A file's key in a config set: relative to the config's folder, so the same config hashes the same anywhere. */
function snapshotKeyOf(rootDir: string, file: string): string {
  return isPathInside(file, rootDir) ? path.relative(rootDir, file) : path.join(OUTSIDE_ROOT_DIR, file);
}

function byKey(a: readonly [string, string], b: readonly [string, string]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/** Hashed, since a name is a path or contains one. */
function nameFileOf(trustDir: string, name: string): string {
  return path.join(trustDir, NAMES_DIR, createHash("sha256").update(name).digest("hex"));
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
