/**
 * Derives a worktree's Docker Compose project name.
 * @param repo - Bare repo name under `worktrees/`.
 * @param branch - Branch path, e.g. `"feature/x"`.
 * @returns The compose project name, e.g. `"torq-feature-x"`.
 */
export function composeProjectName(repo: string, branch: string): string {
    // Mirrors _compose_project_name (lib/container.sh) byte-for-byte — must match
    // exactly or container/agent lookups silently miss.
    const lowered = branch.replace(/[A-Z/]/g, (char): string => (char === "/" ? "-" : char.toLowerCase()));
    const collapsed = lowered.replace(/[^a-z0-9-]+/g, "-");
    return `${repo}-${collapsed}`;
}
