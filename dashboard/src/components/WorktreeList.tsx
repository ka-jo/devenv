import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { useTerminalSize } from "../hooks/useTerminalSize.ts";
import type { CardStatus, WorktreeStatus } from "../state/selectors/worktreeStatuses.ts";
import { DETAIL_WIDTH } from "./ContainerDetail.tsx";
import { TitledBox } from "./TitledBox.tsx";

/** Gap between the list and the detail column, in terminal cells. */
const LIST_GAP = 1;
/** Cells `ink-select-input`'s indicator column reserves (one glyph + its `marginRight`). */
const INDICATOR_WIDTH = 2;
/** Column widths, in terminal cells: repo, branch, status (glyph + longest label `"Needs input"`), uptime. */
const COLUMN_WIDTHS = { repo: 24, branch: 20, status: 14, uptime: 8 } as const;
/** Rows consumed outside the scrollable list itself: the box's title line, header row, and bottom border. */
const LIST_CHROME_HEIGHT = 3;

/** Glyph/color/label for one {@link CardStatus}. */
const STATUS_DISPLAY: Record<CardStatus, { readonly glyph: string; readonly color: string | undefined; readonly label: string }> = {
    running: { glyph: "●", color: "green", label: "Running" },
    attention: { glyph: "◉", color: "yellow", label: "Needs input" },
    error: { glyph: "■", color: "redBright", label: "Error" },
    stopped: { glyph: "○", color: undefined, label: "Stopped" },
};

/** Which pane currently owns keyboard focus, cycled by Tab. */
export type FocusedPane = "list" | "container" | "agents";

/** Pane order Tab cycles through. */
const PANE_CYCLE: readonly FocusedPane[] = ["list", "container", "agents"];

/** Props for {@link WorktreeList}. */
export interface WorktreeListProps {
    /** Whether the list should route keyboard input (`false` while the prompt bar is capturing a command). */
    readonly isActive: boolean;
    /** All worktree statuses, one row each. */
    readonly cards: readonly WorktreeStatus[];
    /** Called whenever the currently-focused row changes, or `undefined` when the list is empty. */
    readonly onFocusedCardChange: (card: WorktreeStatus | undefined) => void;
    /** Called whenever the focused pane changes (Tab-cycled, or Enter/Escape shortcuts into/out of the agents pane). */
    readonly onFocusedPaneChange: (pane: FocusedPane) => void;
    /** Called whenever the agent-row cursor moves, or `undefined` when the agents pane has no row selected. */
    readonly onFocusedAgentIndexChange: (index: number | undefined) => void;
    /** Called when the user attaches to a specific agent row (Enter on a selected agent, in the agents pane). */
    readonly onAttachAgent: (repo: string, branch: string, agentId: string) => void;
}

/**
 * Master list of worktrees: one scrollable row each (repo, branch, aggregated status, uptime).
 * Tab cycles keyboard focus through list → container → agents → list; Enter on a row with
 * agents jumps straight to the agents pane as a shortcut, and Escape returns to the list.
 * @param props - See {@link WorktreeListProps}.
 * @returns The rendered list.
 */
export function WorktreeList({
    isActive,
    cards,
    onFocusedCardChange,
    onFocusedPaneChange,
    onFocusedAgentIndexChange,
    onAttachAgent,
}: WorktreeListProps): JSX.Element {
    const { columns: terminalColumns, rows: terminalRows } = useTerminalSize();
    const width = Math.max(30, terminalColumns - DETAIL_WIDTH - LIST_GAP);
    const [focusedIndex, setFocusedIndex] = useState<number>(0);
    const [focusedPane, setFocusedPane] = useState<FocusedPane>("list");
    const [focusedAgentIndex, setFocusedAgentIndex] = useState<number | undefined>(undefined);

    const lastIndex = Math.max(0, cards.length - 1);
    const effectiveIndex = Math.min(focusedIndex, lastIndex);
    const focusedCard = cards[effectiveIndex];

    // Moving to a different row always drops back to row-level focus — a pane focused on the
    // previous row's agents/container doesn't carry over to the newly-focused one.
    useEffect((): void => setFocusedPane("list"), [effectiveIndex]);
    useEffect((): void => setFocusedAgentIndex(undefined), [effectiveIndex]);
    // The agent-row cursor only makes sense while the agents pane is focused.
    useEffect((): void => {
        if (focusedPane !== "agents") {
            setFocusedAgentIndex(undefined);
        }
    }, [focusedPane]);

    useEffect((): void => onFocusedCardChange(focusedCard), [focusedCard, onFocusedCardChange]);
    useEffect((): void => onFocusedPaneChange(focusedPane), [focusedPane, onFocusedPaneChange]);
    useEffect((): void => onFocusedAgentIndexChange(focusedAgentIndex), [focusedAgentIndex, onFocusedAgentIndexChange]);

    const limit = Math.max(1, terminalRows - LIST_CHROME_HEIGHT);

    const items: WorktreeListItem[] = useMemo(
        (): WorktreeListItem[] => cards.map((card): WorktreeListItem => ({ key: `${card.repo}/${card.branch}`, label: card.branch, value: card })),
        [cards],
    );

    useInput(
        (_input, key): void => {
            if (key.tab) {
                setFocusedPane((current): FocusedPane => {
                    const nextIndex = (PANE_CYCLE.indexOf(current) + 1) % PANE_CYCLE.length;
                    return PANE_CYCLE[nextIndex] ?? "list";
                });
                return;
            }
            if (key.escape) {
                setFocusedPane("list");
                return;
            }
            if (focusedCard === undefined || focusedPane !== "agents") {
                return;
            }
            // Agent-row cursor: Up/Down move between the focused row's agents, Enter attaches.
            const agentIndex = focusedAgentIndex ?? 0;
            const lastAgentIndex = Math.max(0, focusedCard.agents.length - 1);
            if (key.upArrow) {
                setFocusedAgentIndex(Math.max(0, agentIndex - 1));
            } else if (key.downArrow) {
                setFocusedAgentIndex(Math.min(lastAgentIndex, agentIndex + 1));
            } else if (key.return) {
                const agent = focusedCard.agents[agentIndex];
                if (agent !== undefined) {
                    onAttachAgent(focusedCard.repo, focusedCard.branch, agent.id);
                }
            }
        },
        { isActive },
    );

    const isListFocused = isActive && focusedPane === "list";

    if (cards.length === 0) {
        return (
            <TitledBox title="WORKTREES" width={width} isFocused={isListFocused} marginRight={LIST_GAP}>
                <Box flexGrow={1} alignItems="center" justifyContent="center">
                    <Text dimColor>No worktrees</Text>
                </Box>
            </TitledBox>
        );
    }

    return (
        <TitledBox title="WORKTREES" width={width} isFocused={isListFocused} marginRight={LIST_GAP}>
            <Box marginBottom={1} marginLeft={INDICATOR_WIDTH}>
                <HeaderRow />
            </Box>
            <SelectInput
                items={items}
                isFocused={isListFocused}
                limit={limit}
                itemComponent={WorktreeRow}
                onHighlight={(item: { value: WorktreeStatus }): void => setFocusedIndex(cards.indexOf(item.value))}
                onSelect={(item: { value: WorktreeStatus }): void => {
                    if (item.value.agents.length > 0) {
                        setFocusedAgentIndex(0);
                        setFocusedPane("agents");
                    }
                }}
            />
        </TitledBox>
    );
}

/** Row shape `ink-select-input` expects; redeclared here since the library exports only the `Item` component, not its `Item<V>` type. */
interface WorktreeListItem {
    readonly key: string;
    readonly label: string;
    readonly value: WorktreeStatus;
}

/** Column header line, aligned with {@link WorktreeRow}'s columns. */
function HeaderRow(): JSX.Element {
    return (
        <Text dimColor>
            {"REPO".padEnd(COLUMN_WIDTHS.repo)}
            {"BRANCH".padEnd(COLUMN_WIDTHS.branch)}
            {"STATUS".padEnd(COLUMN_WIDTHS.status)}
            {"UPTIME".padEnd(COLUMN_WIDTHS.uptime)}
        </Text>
    );
}

/** Props for {@link WorktreeRow}. */
interface WorktreeRowProps {
    readonly isSelected?: boolean;
    // Optional only so this structurally satisfies ink-select-input's ItemProps — the
    // library always spreads the full WorktreeListItem at runtime.
    readonly value?: WorktreeStatus;
}

/** Custom `ink-select-input` row: fixed-width repo/branch/status/uptime columns. */
function WorktreeRow({ isSelected, value: card }: WorktreeRowProps): JSX.Element {
    if (card === undefined) {
        return <Text> </Text>;
    }
    const { glyph, color, label } = STATUS_DISPLAY[card.status];
    const uptime = card.status === "running" || card.status === "attention" ? (card.uptime ?? "?") : "—";
    const rowColor = isSelected ? "redBright" : undefined;

    return (
        <Text color={rowColor}>
            {fitColumn(card.repo.toUpperCase(), COLUMN_WIDTHS.repo)}
            {fitColumn(card.branch, COLUMN_WIDTHS.branch)}
            <Text color={rowColor ?? color}>{fitColumn(`${glyph} ${label}`, COLUMN_WIDTHS.status)}</Text>
            {fitColumn(uptime, COLUMN_WIDTHS.uptime)}
        </Text>
    );
}

/** Clamps `text` to exactly `width` cells: truncates with a trailing `…` if too long, pads with spaces if short. */
function fitColumn(text: string, width: number): string {
    if (text.length <= width) {
        return text.padEnd(width);
    }
    return `${text.slice(0, Math.max(0, width - 1))}…`;
}
