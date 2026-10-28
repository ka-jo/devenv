import os from "node:os";
import path from "node:path";
import { REPO_DIR } from "../../lib/paths.ts";

/** Where {@link REPO_DIR} is mounted inside every worktree's container. */
const CONTAINER_REPO_DIR = "/devenv";

/** Host-only per-worktree state written by `devenv container up` (STATE_DIR in lib/container.sh). */
const STATE_DIR = path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local/state"), "devenv");

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
  // Mirrors CT_WORKDIR (lib/container.sh): worktrees are mounted at their
  // ~/devenv-relative path under CONTAINER_REPO_DIR, not /workspace.
  const workdir = path.posix.join(CONTAINER_REPO_DIR, path.relative(REPO_DIR, worktreePath));
  const user = await readContainerUser(projectName);
  const proc = Bun.spawn(
    [
      "docker",
      "exec",
      ...(user === undefined ? [] : ["-u", user]),
      "-w",
      workdir,
      `${projectName}-devcontainer`,
      "claude",
      "agents",
      "--json",
      "--all",
      "--cwd",
      workdir,
    ],
    { stdout: "pipe", stderr: "ignore" },
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

/**
 * Reads the user `devenv container up` recorded for a worktree's container in its meta.json, or `undefined` if none was
 * recorded yet — `docker exec` then falls back to the image's default user.
 */
async function readContainerUser(projectName: string): Promise<string | undefined> {
  try {
    const meta: unknown = await Bun.file(path.join(STATE_DIR, projectName, "meta.json")).json();
    if (typeof meta === "object" && meta !== null && "user" in meta && typeof meta.user === "string") {
      return meta.user;
    }
  } catch {
    // Missing or malformed meta.json gets the same fallback as no recorded user.
  }
  return undefined;
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
