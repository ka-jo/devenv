import path from "node:path";

/** Absolute path to the shared devcontainer compose file every worktree's container is defined by. */
const COMPOSE_FILE = path.resolve(import.meta.dir, "../../../devcontainer/docker-compose.yml");

/** In-container path to the wrapper that adds firewall proxy env before invoking `claude`. */
const CLAUDE_WRAPPER = "/home/ka-jo/devenv/bin/claude-wrapper";

/** One entry from `claude agents --json --all`. Only the field this module reads. */
interface ClaudeAgentEntry {
    readonly kind?: string;
}

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

/**
 * Whether a worktree's devcontainer is currently running.
 *
 * @param projectName - Compose project name from {@link composeProjectName}.
 * @returns `true` if `docker ps` finds a running container for that project.
 */
export async function isContainerRunning(projectName: string): Promise<boolean> {
    const proc = Bun.spawn(
        ["docker", "ps", "--filter", `label=com.docker.compose.project=${projectName}`, "--filter", "status=running", "-q"],
        { stdout: "pipe", stderr: "ignore" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.trim().length > 0;
}

/**
 * Counts running background Claude Code agents in a worktree's container.
 * @param projectName - Compose project name from {@link composeProjectName}.
 * @param worktreePath - Absolute path to the worktree checkout.
 * @returns Number of background agents, or `0` if the count couldn't be read.
 */
export async function countBackgroundAgents(projectName: string, worktreePath: string): Promise<number> {
    const proc = Bun.spawn(
        [
            "docker",
            "compose",
            "-p",
            projectName,
            "-f",
            COMPOSE_FILE,
            "exec",
            "-T",
            "devcontainer",
            CLAUDE_WRAPPER,
            "agents",
            "--json",
            "--all",
            "--cwd",
            "/workspace",
        ],
        {
            // WORKSPACE_DIR isn't needed for `exec` to find the container — only `up` uses
            // it — but compose still interpolates it from the file, so set it to avoid a warning.
            env: { ...process.env, WORKSPACE_DIR: worktreePath, COMPOSE_PROJECT_NAME: projectName },
            stdout: "pipe",
            stderr: "ignore",
        },
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    // Degrades to 0 on any exec failure (container gone, claude not ready, etc.) — a
    // poll-driven sidebar count shouldn't throw on a transient miss.
    if (exitCode !== 0) {
        return 0;
    }

    try {
        const entries = JSON.parse(output) as readonly ClaudeAgentEntry[];
        // Same filter cmd_agent_list applies to its rows (lib/agent.sh).
        return entries.filter((entry): boolean => entry.kind === "background").length;
    } catch {
        return 0;
    }
}
