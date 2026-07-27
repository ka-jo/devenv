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
}

/**
 * Main content area: a paged grid of worktree cards. Page size is derived from the terminal's
 * current dimensions, not fixed — see {@link CARD_WIDTH}/{@link CARD_HEIGHT}.
 * @param props - See {@link GridProps}.
 * @returns The rendered grid.
 */
export function Grid({ cards, selectedRepo, isFocused, onPageInfoChange }: GridProps): JSX.Element {
    const { columns: terminalColumns, rows: terminalRows } = useTerminalSize();
    const [focusedIndex, setFocusedIndex] = useState<number>(0);

    const filtered = useMemo(
        (): readonly WorktreeStatus[] => (selectedRepo === undefined ? cards : cards.filter((c): boolean => c.repo === selectedRepo)),
        [cards, selectedRepo],
    );

    useEffect((): void => setFocusedIndex(0), [selectedRepo]);

    const columnCount = Math.max(1, Math.floor((terminalColumns - SIDEBAR_WIDTH - 1) / (CARD_WIDTH + CARD_GAP)));
    const rowCount = Math.max(1, Math.floor((terminalRows - PROMPT_BAR_HEIGHT - PAGINATION_BAR_HEIGHT) / (CARD_HEIGHT + CARD_GAP)));
    const pageSize = columnCount * rowCount;

    const lastIndex = Math.max(0, filtered.length - 1);
    const effectiveIndex = Math.min(focusedIndex, lastIndex);
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
            }
        },
        { isActive: isFocused },
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
            {visibleCards.map(
                (card, offset): JSX.Element => (
                    <WorktreeCardView
                        key={`${card.repo}/${card.branch}`}
                        card={card}
                        isFocused={isFocused && pageStart + offset === effectiveIndex}
                    />
                ),
            )}
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
}

/** One worktree card: repo/branch kicker (left, own bounded width) beside a status badge (right, own reserved width), a container meta line, and its agent sessions. */
function WorktreeCardView({ card, isFocused }: WorktreeCardViewProps): JSX.Element {
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
            <AgentRows agents={card.agents} />
        </Box>
    );
}

/** Props for {@link AgentRows}. */
interface AgentRowsProps {
    readonly agents: readonly AgentInfo[];
}

/** Up to {@link MAX_AGENT_ROWS} agent-session lines, collapsing any excess into a trailing "+N more" line. */
function AgentRows({ agents }: AgentRowsProps): JSX.Element {
    if (agents.length === 0) {
        return <Text dimColor>No agents</Text>;
    }

    const overflowCount = agents.length > MAX_AGENT_ROWS ? agents.length - (MAX_AGENT_ROWS - 1) : 0;
    const visibleCount = overflowCount > 0 ? MAX_AGENT_ROWS - 1 : agents.length;

    return (
        <>
            {agents.slice(0, visibleCount).map((agent): JSX.Element => <AgentRow key={agent.id} agent={agent} />)}
            {overflowCount > 0 && <Text dimColor>{`+${overflowCount} more`}</Text>}
        </>
    );
}

/** Props for {@link AgentRow}. */
interface AgentRowProps {
    readonly agent: AgentInfo;
}

/** One agent session line: status dot, session name, state label (or what it's waiting on, if blocked), and elapsed runtime. */
function AgentRow({ agent }: AgentRowProps): JSX.Element {
    const { glyph, color, label } = AGENT_STATUS_DISPLAY[agent.state];
    const statusText = agent.state === "blocked" && agent.waitingFor !== undefined ? agent.waitingFor : label;
    return (
        <Text wrap="truncate-end">
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
