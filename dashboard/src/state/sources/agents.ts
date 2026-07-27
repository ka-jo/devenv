import path from "node:path";
import { REPO_DIR } from "../../lib/paths.ts";

/** Absolute path to the shared devcontainer compose file every worktree's container is defined by. */
const COMPOSE_FILE = path.join(REPO_DIR, "devcontainer/docker-compose.yml");

/** Lifecycle state of one Claude Code background agent session, per `claude agents --json`. */
export type AgentState = "working" | "blocked" | "done" | "failed" | "stopped";

/** One running or recently-run background Claude Code agent session inside a worktree's container. */
export interface AgentInfo {
  /** Background-session id, stable for the life of the session. */
  readonly id: string;
  /** User-set or auto-generated session name, or `undefined` if the CLI reported none. */
  readonly name: string | undefined;
  /** Current lifecycle state. */
  readonly state: AgentState;
  /** What the session is blocked on, e.g. `"permission prompt"` — only set while `state === "blocked"`. */
  readonly waitingFor: string | undefined;
  /** ISO timestamp the session started at. */
  readonly startedAt: string;
}

/** One entry from `claude agents --json --all`. Only the fields this module reads. */
interface ClaudeAgentEntry {
  readonly kind?: string;
  readonly id?: string;
  readonly name?: string;
  readonly state?: string;
  readonly waitingFor?: string;
  readonly startedAt?: string;
}

const AGENT_STATES: ReadonlySet<string> = new Set<AgentState>(["working", "blocked", "done", "failed", "stopped"]);

/**
 * Lists running/recent background Claude Code agents in a worktree's container.
 * @param projectName - Compose project name from `composeProjectName` (identifiers.ts).
 * @param worktreePath - Absolute path to the worktree checkout.
 * @returns Background agent sessions, or `[]` if the list couldn't be read.
 */
export async function listBackgroundAgents(
  projectName: string,
  worktreePath: string,
): Promise<AgentInfo[]> {
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
      "claude",
      "agents",
      "--json",
      "--all",
      "--cwd",
      "/workspace",
    ],
    {
      // WORKSPACE_DIR isn't needed for `exec` to find the container — only `up` uses
      // it — but compose still interpolates it from the file, so set it to avoid a warning.
      env: {
        ...process.env,
        WORKSPACE_DIR: worktreePath,
        COMPOSE_PROJECT_NAME: projectName,
      },
      stdout: "pipe",
      stderr: "ignore",
    },
  );
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  // Degrades to [] on any exec failure (container gone, claude not ready, etc.) — a
  // poll-driven grid shouldn't throw on a transient miss.
  if (exitCode !== 0) {
    return [];
  }

  try {
    const entries = JSON.parse(output) as readonly ClaudeAgentEntry[];
    // Same filter cmd_agent_list applies to its rows (lib/agent.sh).
    return entries
      .filter((entry): boolean => entry.kind === "background")
      .map(parseAgentInfo)
      .filter((agent): agent is AgentInfo => agent !== undefined);
  } catch {
    return [];
  }
}

/** Converts one raw `claude agents --json` background entry into an {@link AgentInfo}, or `undefined` if required fields are missing/malformed. */
function parseAgentInfo(entry: ClaudeAgentEntry): AgentInfo | undefined {
  if (entry.id === undefined || entry.startedAt === undefined || entry.state === undefined || !AGENT_STATES.has(entry.state)) {
    return undefined;
  }
  return {
    id: entry.id,
    name: entry.name,
    state: entry.state as AgentState,
    waitingFor: entry.waitingFor,
    startedAt: entry.startedAt,
  };
}
