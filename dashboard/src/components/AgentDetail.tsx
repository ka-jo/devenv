import type { JSX } from "react";
import { Text } from "ink";
import type { AgentInfo, AgentState } from "../state/sources/agents.ts";
import type { WorktreeStatus } from "../state/selectors/worktreeStatuses.ts";
import { DETAIL_WIDTH } from "./ContainerDetail.tsx";
import { TitledBox } from "./TitledBox.tsx";

/** Glyph/color/label for one {@link AgentState}. */
const AGENT_STATUS_DISPLAY: Record<AgentState, { readonly glyph: string; readonly color: string | undefined; readonly label: string }> = {
    working: { glyph: "●", color: "green", label: "Working" },
    blocked: { glyph: "◉", color: "yellow", label: "Blocked" },
    done: { glyph: "○", color: undefined, label: "Done" },
    failed: { glyph: "■", color: "redBright", label: "Failed" },
    stopped: { glyph: "○", color: undefined, label: "Stopped" },
};

/** Props for {@link AgentDetail}. */
export interface AgentDetailProps {
    /** The currently-focused worktree row, or `undefined` if the list is empty. */
    readonly card: WorktreeStatus | undefined;
    /** Whether the agents pane currently owns keyboard focus. */
    readonly isFocused: boolean;
    /** Row-cursor position within `card.agents`, or `undefined` when no row is selected. */
    readonly focusedAgentIndex: number | undefined;
}

/**
 * Detail box listing the focused worktree's background agent sessions.
 * @param props - See {@link AgentDetailProps}.
 * @returns The rendered box.
 */
export function AgentDetail({ card, isFocused, focusedAgentIndex }: AgentDetailProps): JSX.Element {
    const title = card === undefined ? "AGENTS" : `AGENTS — ${card.repo}/${card.branch}`;

    return (
        <TitledBox title={title} width={DETAIL_WIDTH} isFocused={isFocused} flexGrow={1}>
            {card === undefined ? (
                <Text dimColor>No worktree selected</Text>
            ) : (
                <AgentRows agents={card.agents} focusedAgentIndex={isFocused ? focusedAgentIndex : undefined} />
            )}
        </TitledBox>
    );
}

/** Props for {@link AgentRows}. */
interface AgentRowsProps {
    readonly agents: readonly AgentInfo[];
    readonly focusedAgentIndex: number | undefined;
}

/** One line per agent session, each highlighted when it matches `focusedAgentIndex`. */
function AgentRows({ agents, focusedAgentIndex }: AgentRowsProps): JSX.Element {
    if (agents.length === 0) {
        return <Text dimColor>No agents</Text>;
    }

    return (
        <>
            {agents.map(
                (agent, index): JSX.Element => <AgentRow key={agent.id} agent={agent} isFocused={index === focusedAgentIndex} />,
            )}
        </>
    );
}

/** Props for {@link AgentRow}. */
interface AgentRowProps {
    readonly agent: AgentInfo;
    readonly isFocused: boolean;
}

/** One agent session line: status dot, session name, state label (or what it's waiting on, if blocked), and elapsed runtime. */
function AgentRow({ agent, isFocused }: AgentRowProps): JSX.Element {
    const { glyph, color, label } = AGENT_STATUS_DISPLAY[agent.state];
    const statusText = agent.state === "blocked" && agent.waitingFor !== undefined ? agent.waitingFor : label;
    const rowColor = isFocused ? "redBright" : undefined;
    return (
        <Text color={rowColor} wrap="truncate-end">
            <Text color={rowColor ?? color}>{glyph}</Text>
            {` ${agent.name ?? agent.id}  ${statusText} · ${formatElapsed(agent.startedAt)}`}
        </Text>
    );
}

/** Formats the time since an ISO timestamp as a short elapsed label, e.g. `"3m"` or `"1h 12m"`. */
function formatElapsed(startedAt: string): string {
    const elapsedMs = Math.max(0, Date.now() - Date.parse(startedAt));
    const totalMinutes = Math.floor(elapsedMs / 60_000);
    if (totalMinutes < 1) {
        return `${Math.floor(elapsedMs / 1000)}s`;
    }
    if (totalMinutes < 60) {
        return `${totalMinutes}m`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
}
