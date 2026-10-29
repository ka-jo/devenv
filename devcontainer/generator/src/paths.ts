import path from "node:path";
import type { GeneratorContext } from "./context.ts";

/**
 * Maps a host path under the devenv repo to where it appears inside the container — the "mirrored path" that keeps
 * relative gitdir links resolving the same on both sides.
 *
 * @param context - Supplies the host repo dir and its container mount point.
 * @param hostPath - An absolute host path inside {@link GeneratorContext.repoDir}.
 * @returns The corresponding absolute container path.
 */
export function containerPathOf(context: GeneratorContext, hostPath: string): string {
  return path.posix.join(context.containerRepoDir, path.relative(context.repoDir, hostPath));
}
