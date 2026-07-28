import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalSize } from "../hooks/useTerminalSize.ts";
import type { AgentInfo, AgentState } from "../state/sources/agents.ts";
import type { CardStatus, WorktreeStatus } from "../state/selectors/worktreeStatuses.ts";
import { SIDEBAR_WIDTH } from "./Sidebar.tsx";

/** Fixed width of one card, in terminal cells (border included). */
const CARD_WIDTH = 36;
/** Max agent rows rendered per card before collapsing the rest into a "+N more" line — keeps card height fixed so the page-size math in {@link Grid} stays accurate regardless of how many agents a container runs. */
const MAX_AGENT_ROWS = 3;
/** Fixed height of one card, in terminal cells: border(2) + kicker/status header(2) + meta(1) + divider(1) + agent rows. */
const CARD_HEIGHT = 2 + 2 + 1 + 1 + MAX_AGENT_ROWS;
/** Gap between adjacent cards, in terminal cells. */
const CARD_GAP = 1;
/** Reserved width for the status badge (longest label is `"● Running"`, 9 cells) — fixed so it never competes with the repo/branch kicker for space. */
const STATUS_WIDTH = 9;
/** Width left for the repo/branch kicker once border, padding, and the status badge are accounted for. */
const KICKER_WIDTH = CARD_WIDTH - 4 /* border + paddingX */ - STATUS_WIDTH - CARD_GAP;
/** Rows consumed by the prompt bar (top border + one content line). */
const PROMPT_BAR_HEIGHT = 2;
/** Rows consumed by the pagination bar. */
const PAGINATION_BAR_HEIGHT = 1;

/** Current page/selection state of the grid, reported up for {@link PaginationBar} to render. */
export interface GridPageInfo {
    /** Total cards in the current (repo-filtered) list. */
    readonly total: number;
    /** 1-based index of the first card shown on the current page. `0` if `total` is `0`. */
    readonly start: number;
    /** 1-based index of the last card shown on the current page. */
    readonly end: number;
    /** 1-based current page number. */
    readonly page: number;
    /** Total number of pages. Always at least `1`. */
    readonly pageCount: number;
}

/** Props for {@link Grid}. */
export interface GridProps {
    /** All worktree statuses, unfiltered. */
    readonly cards: readonly WorktreeStatus[];
    /** Repo to filter cards to, or `undefined` for every repo. */
    readonly selectedRepo: string | undefined;
    /** Whether the grid is the focused region (routes arrow/paging keys). */
    readonly isFocused: boolean;
    /** Called whenever the current page/selection changes. */
    readonly onPageInfoChange: (info: GridPageInfo) => void;
    /** Called when the user attaches to a specific agent row (row-cursor mode, Enter on a selected agent). */
    readonly onAttachAgent: (repo: string, branch: string, agentId: string) => void;
    /** Called whenever the currently-focused card changes, or `undefined` when nothing is focused. */
    readonly onFocusedCardChange: (card: WorktreeStatus | undefined) => void;
}

/**
 * Main content area: a paged grid of worktree cards. Page size is derived from the terminal's
 * current dimensions, not fixed — see {@link CARD_WIDTH}/{@link CARD_HEIGHT}.
 * @param props - See {@link GridProps}.
 * @returns The rendered grid.
 */
export function Grid({ cards, selectedRepo, isFocused, onPageInfoChange, onAttachAgent, onFocusedCardChange }: GridProps): JSX.Element {
    const { columns: terminalColumns, rows: terminalRows } = useTerminalSize();
    const [focusedIndex, setFocusedIndex] = useState<number>(0);
    const [focusedAgentIndex, setFocusedAgentIndex] = useState<number | undefined>(undefined);

    const filtered = useMemo(
        (): readonly WorktreeStatus[] => (selectedRepo === undefined ? cards : cards.filter((c): boolean => c.repo === selectedRepo)),
        [cards, selectedRepo],
    );

    useEffect((): void => {
        setFocusedIndex(0);
        setFocusedAgentIndex(undefined);
    }, [selectedRepo]);

    const columnCount = Math.max(1, Math.floor((terminalColumns - SIDEBAR_WIDTH - 1) / (CARD_WIDTH + CARD_GAP)));
    const rowCount = Math.max(1, Math.floor((terminalRows - PROMPT_BAR_HEIGHT - PAGINATION_BAR_HEIGHT) / (CARD_HEIGHT + CARD_GAP)));
    const pageSize = columnCount * rowCount;

    const lastIndex = Math.max(0, filtered.length - 1);
    const effectiveIndex = Math.min(focusedIndex, lastIndex);
    const focusedCard = filtered[effectiveIndex];

    // Moving to a different card always drops back to card-level focus — the agent-row
    // cursor only makes sense scoped to whichever card it was opened on.
    useEffect((): void => setFocusedAgentIndex(undefined), [effectiveIndex]);

    useEffect((): void => onFocusedCardChange(focusedCard), [focusedCard, onFocusedCardChange]);

    const page = Math.floor(effectiveIndex / pageSize);
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const pageStart = page * pageSize;
    const visibleCards = filtered.slice(pageStart, pageStart + pageSize);

    useEffect((): void => {
        onPageInfoChange({
            total: filtered.length,
            start: filtered.length === 0 ? 0 : pageStart + 1,
            end: Math.min(filtered.length, pageStart + pageSize),
            page: page + 1,
            pageCount,
        });
    }, [filtered.length, page, pageSize, pageCount, pageStart, onPageInfoChange]);

    useInput(
        (_input, key): void => {
            if (filtered.length === 0) {
                return;
            }
            if (key.leftArrow) {
                setFocusedIndex(Math.max(0, effectiveIndex - 1));
            } else if (key.rightArrow) {
                setFocusedIndex(Math.min(lastIndex, effectiveIndex + 1));
            } else if (key.upArrow) {
                setFocusedIndex(Math.max(0, effectiveIndex - columnCount));
            } else if (key.downArrow) {
                setFocusedIndex(Math.min(lastIndex, effectiveIndex + columnCount));
            } else if (key.pageDown) {
                setFocusedIndex(Math.min(lastIndex, (page + 1) * pageSize));
            } else if (key.pageUp) {
                setFocusedIndex(Math.max(0, (page - 1) * pageSize));
            } else if (key.return) {
                if (focusedCard !== undefined && focusedCard.agents.length > 0) {
                    setFocusedAgentIndex(0);
                }
            }
        },
        { isActive: isFocused && focusedAgentIndex === undefined },
    );

    // Agent-row cursor mode: Up/Down move between the focused card's agents, Enter
    // attaches to the selected one, Escape returns to card-level focus.
    useInput(
        (_input, key): void => {
            if (focusedCard === undefined || focusedAgentIndex === undefined) {
                return;
            }
            const lastAgentIndex = Math.max(0, focusedCard.agents.length - 1);
            if (key.upArrow) {
                setFocusedAgentIndex(Math.max(0, focusedAgentIndex - 1));
            } else if (key.downArrow) {
                setFocusedAgentIndex(Math.min(lastAgentIndex, focusedAgentIndex + 1));
            } else if (key.return) {
                const agent = focusedCard.agents[focusedAgentIndex];
                if (agent !== undefined) {
                    onAttachAgent(focusedCard.repo, focusedCard.branch, agent.id);
                }
            } else if (key.escape) {
                setFocusedAgentIndex(undefined);
            }
        },
        { isActive: isFocused && focusedAgentIndex !== undefined },
    );

    if (filtered.length === 0) {
        return (
            <Box flexGrow={1} alignItems="center" justifyContent="center">
                <Text dimColor>No worktrees</Text>
            </Box>
        );
    }

    return (
        <Box flexGrow={1} flexDirection="row" flexWrap="wrap" alignContent="flex-start" padding={1}>
            {visibleCards.map((card, offset): JSX.Element => {
                const cardIsFocused = isFocused && pageStart + offset === effectiveIndex;
                return (
                    <WorktreeCardView
                        key={`${card.repo}/${card.branch}`}
                        card={card}
                        isFocused={cardIsFocused}
                        focusedAgentIndex={cardIsFocused ? focusedAgentIndex : undefined}
                    />
                );
            })}
        </Box>
    );
}

/** Glyph/color/label for one {@link CardStatus}. */
const STATUS_DISPLAY: Record<CardStatus, { readonly glyph: string; readonly color: string | undefined; readonly label: string }> = {
    running: { glyph: "●", color: "green", label: "Running" },
    attention: { glyph: "◉", color: "yellow", label: "Needs input" },
    error: { glyph: "■", color: "redBright", label: "Error" },
    stopped: { glyph: "○", color: undefined, label: "Stopped" },
};

/** Glyph/color/label for one {@link AgentState}. */
const AGENT_STATUS_DISPLAY: Record<AgentState, { readonly glyph: string; readonly color: string | undefined; readonly label: string }> = {
    working: { glyph: "●", color: "green", label: "Working" },
    blocked: { glyph: "◉", color: "yellow", label: "Blocked" },
    done: { glyph: "○", color: undefined, label: "Done" },
    failed: { glyph: "■", color: "redBright", label: "Failed" },
    stopped: { glyph: "○", color: undefined, label: "Stopped" },
};

/** Props for {@link WorktreeCardView}. */
interface WorktreeCardViewProps {
    readonly card: WorktreeStatus;
    readonly isFocused: boolean;
    /** Row-cursor position within `card.agents`, or `undefined` when not in agent-row focus mode. */
    readonly focusedAgentIndex: number | undefined;
}

/** One worktree card: repo/branch kicker (left, own bounded width) beside a status badge (right, own reserved width), a container meta line, and its agent sessions. */
function WorktreeCardView({ card, isFocused, focusedAgentIndex }: WorktreeCardViewProps): JSX.Element {
    const { glyph, color, label } = STATUS_DISPLAY[card.status];
    const meta =
        card.status === "running" || card.status === "attention"
            ? `container ${card.containerId ?? "?"}  ·  up ${card.uptime ?? "?"}`
            : card.status === "error"
              ? `container ${card.containerId ?? "?"}  ·  exited`
              : "—";

    return (
        <Box
            width={CARD_WIDTH}
            height={CARD_HEIGHT}
            marginRight={CARD_GAP}
            marginBottom={CARD_GAP}
            flexDirection="column"
            paddingX={1}
            borderStyle={isFocused ? "bold" : "single"}
            borderColor={isFocused ? "redBright" : undefined}
            overflow="hidden"
        >
            <Box justifyContent="space-between">
                <Box width={KICKER_WIDTH} flexDirection="column">
                    <Text dimColor wrap="truncate-end">
                        {card.repo.toUpperCase()}
                    </Text>
                    <Text bold wrap="truncate-end">
                        {card.branch}
                    </Text>
                </Box>
                <Box width={STATUS_WIDTH} justifyContent="flex-end">
                    <Text color={color}>{`${glyph} ${label}`}</Text>
                </Box>
            </Box>
            <Text dimColor wrap="truncate-end">
                {meta}
            </Text>
            <Text dimColor>{"─".repeat(CARD_WIDTH - 4)}</Text>
            <AgentRows agents={card.agents} selectedIndex={focusedAgentIndex} />
        </Box>
    );
}

/** Props for {@link AgentRows}. */
interface AgentRowsProps {
    readonly agents: readonly AgentInfo[];
    /** Row-cursor position to highlight, or `undefined` to use the plain "+N more" collapse. */
    readonly selectedIndex: number | undefined;
}

/**
 * Up to {@link MAX_AGENT_ROWS} agent-session lines.
 *
 * With no selection, collapses any excess into a trailing "+N more" line. With a
 * selection, instead renders a sliding window of size {@link MAX_AGENT_ROWS} kept
 * centered on `selectedIndex` — so row-cursor mode can reach every agent without
 * growing the card past its fixed height — with `↑`/`↓ N more` cues in place of a
 * clipped edge row.
 */
function AgentRows({ agents, selectedIndex }: AgentRowsProps): JSX.Element {
    if (agents.length === 0) {
        return <Text dimColor>No agents</Text>;
    }

    if (selectedIndex === undefined) {
        const overflowCount = agents.length > MAX_AGENT_ROWS ? agents.length - (MAX_AGENT_ROWS - 1) : 0;
        const visibleCount = overflowCount > 0 ? MAX_AGENT_ROWS - 1 : agents.length;
        return (
            <>
                {agents.slice(0, visibleCount).map((agent): JSX.Element => <AgentRow key={agent.id} agent={agent} isSelected={false} />)}
                {overflowCount > 0 && <Text dimColor>{`+${overflowCount} more`}</Text>}
            </>
        );
    }

    const clampedIndex = Math.max(0, Math.min(selectedIndex, agents.length - 1));
    const { start, end, showTopCue, showBottomCue } = computeAgentWindow(agents.length, clampedIndex, MAX_AGENT_ROWS);

    return (
        <>
            {showTopCue && <Text dimColor>{`↑ ${start} more`}</Text>}
            {agents.slice(start, end).map((agent, offset): JSX.Element => (
                <AgentRow key={agent.id} agent={agent} isSelected={start + offset === clampedIndex} />
            ))}
            {showBottomCue && <Text dimColor>{`↓ ${agents.length - end} more`}</Text>}
        </>
    );
}

/** A sliding window into an agent list, kept centered on the selected index within a fixed row budget. */
interface AgentWindow {
    /** First visible agent index (inclusive). */
    readonly start: number;
    /** Last visible agent index (exclusive). */
    readonly end: number;
    /** Whether a "more above" cue row is needed, consuming one row from `windowSize`. */
    readonly showTopCue: boolean;
    /** Whether a "more below" cue row is needed, consuming one row from `windowSize`. */
    readonly showBottomCue: boolean;
}

/**
 * Computes a fixed-`windowSize`-row window over `total` agents that keeps `selectedIndex`
 * visible, shrinking the content rows to make room for a top/bottom cue as needed.
 * @param total - Total agent count.
 * @param selectedIndex - Index to keep visible, already clamped to `[0, total - 1]`.
 * @param windowSize - Total rows available (cue rows included).
 * @returns The resolved window — see {@link AgentWindow}.
 */
function computeAgentWindow(total: number, selectedIndex: number, windowSize: number): AgentWindow {
    if (total <= windowSize) {
        return { start: 0, end: total, showTopCue: false, showBottomCue: false };
    }

    let showTopCue = false;
    let showBottomCue = false;
    // Converges in at most 2 passes: each pass can only ever flip a cue from off to
    // on (never back off), so the loop settles once both cues stop changing.
    for (let pass = 0; pass < 2; pass++) {
        const contentRows: number = windowSize - (showTopCue ? 1 : 0) - (showBottomCue ? 1 : 0);
        const start: number = Math.max(0, Math.min(selectedIndex - Math.floor((contentRows - 1) / 2), total - contentRows));
        const end: number = start + contentRows;
        const nextShowTopCue: boolean = start > 0;
        const nextShowBottomCue: boolean = end < total;
        if (nextShowTopCue === showTopCue && nextShowBottomCue === showBottomCue) {
            return { start, end, showTopCue, showBottomCue };
        }
        showTopCue = nextShowTopCue;
        showBottomCue = nextShowBottomCue;
    }

    const contentRows = windowSize - (showTopCue ? 1 : 0) - (showBottomCue ? 1 : 0);
    const start = Math.max(0, Math.min(selectedIndex - Math.floor((contentRows - 1) / 2), total - contentRows));
    return { start, end: start + contentRows, showTopCue, showBottomCue };
}

/** Props for {@link AgentRow}. */
interface AgentRowProps {
    readonly agent: AgentInfo;
    /** Whether this row is the row-cursor's current selection. */
    readonly isSelected: boolean;
}

/** One agent session line: status dot, session name, state label (or what it's waiting on, if blocked), and elapsed runtime. */
function AgentRow({ agent, isSelected }: AgentRowProps): JSX.Element {
    const { glyph, color, label } = AGENT_STATUS_DISPLAY[agent.state];
    const statusText = agent.state === "blocked" && agent.waitingFor !== undefined ? agent.waitingFor : label;
    return (
        <Text wrap="truncate-end" inverse={isSelected}>
            <Text color={color}>{glyph}</Text>
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
