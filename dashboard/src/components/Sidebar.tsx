import type { JSX } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { RepoSummary } from "../lib/repoSummaries.ts";

/** Fixed column width of the sidebar, in terminal cells. */
const SIDEBAR_WIDTH = 30;

/** Sentinel `value` for the "All repos" row — maps to `selectedRepo === undefined` (no filter). */
const ALL_REPOS_VALUE = undefined;

/** Props for {@link Sidebar}. */
export interface SidebarProps {
    /** Per-repo worktree/agent counts to list, one row per repo. */
    readonly summaries: readonly RepoSummary[];
    /** Whether the sidebar is the focused region (routes arrow-key input). */
    readonly isFocused: boolean;
    /** Called with the repo name whenever the highlighted row changes, or `undefined` for "All repos". */
    readonly onSelectRepo: (repo: string | undefined) => void;
}

/**
 * Left-hand repo list: pinned "All repos" row, then one row per repo. Highlighting a row
 * (arrow keys) reports the selection live — no separate confirm step.
 * @param props - See {@link SidebarProps}.
 * @returns The rendered sidebar.
 */
export function Sidebar({ summaries, isFocused, onSelectRepo }: SidebarProps): JSX.Element {
    const totalWorktrees = summaries.reduce((sum, s): number => sum + s.worktreeCount, 0);
    const totalAgents = summaries.reduce((sum, s): number => sum + s.agentCount, 0);

    const items: RepoListItem[] = [
        {
            key: "__all__",
            label: "All repos",
            value: ALL_REPOS_VALUE,
            worktreeCount: totalWorktrees,
            agentCount: totalAgents,
            hasDividerBelow: true,
        },
        ...summaries.map(
            (s): RepoListItem => ({
                key: s.repo,
                label: s.repo,
                value: s.repo,
                worktreeCount: s.worktreeCount,
                agentCount: s.agentCount,
                hasDividerBelow: false,
            }),
        ),
    ];

    return (
        <Box
            flexDirection="column"
            width={SIDEBAR_WIDTH}
            borderStyle="single"
            borderTop={false}
            borderBottom={false}
            borderRight
            borderLeft={false}
            paddingX={1}
        >
            <Box marginBottom={1}>
                <Text dimColor>REPOS</Text>
            </Box>
            <SelectInput
                items={items}
                isFocused={isFocused}
                itemComponent={RepoRow}
                onHighlight={(item: { value: string | undefined }): void => onSelectRepo(item.value)}
            />
        </Box>
    );
}

/** Row shape `ink-select-input` expects; redeclared here since the library exports only the `Item` component, not its `Item<V>` type. */
interface RepoListItem {
    readonly key: string;
    readonly label: string;
    readonly value: string | undefined;
    readonly worktreeCount: number;
    readonly agentCount: number;
    /** Whether a horizontal rule renders below this row — set only on "All repos". */
    readonly hasDividerBelow: boolean;
}

/** Props for {@link RepoRow}. */
interface RepoRowProps {
    readonly isSelected?: boolean;
    readonly label: string;
    // Fields below are optional only so this structurally satisfies ink-select-input's
    // ItemProps — the library always spreads the full RepoListItem at runtime.
    readonly worktreeCount?: number;
    readonly agentCount?: number;
    readonly hasDividerBelow?: boolean;
}

/** Custom `ink-select-input` row: name line, dim worktree/agent counts below, optional divider. */
function RepoRow({
    isSelected,
    label,
    worktreeCount = 0,
    agentCount = 0,
    hasDividerBelow = false,
}: RepoRowProps): JSX.Element {
    // A two-line Box still aligns under ink-select-input's indicator column: the indicator
    // is its own one-line Box beside this one, so both lines share its left offset.
    return (
        <Box flexDirection="column">
            <Text color={isSelected ? "blueBright" : undefined} wrap="truncate-end">
                {label}
            </Text>
            <Box flexDirection="row" flexWrap="wrap">
                <Text dimColor>{`${worktreeCount} worktrees`}</Text>
                <Text dimColor>{"·"}</Text>
                <Text dimColor>{`${agentCount} agents`}</Text>
            </Box>
            {hasDividerBelow ? (
                <Box marginLeft={-2} width={SIDEBAR_WIDTH - 3} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} />
            ) : null}
        </Box>
    );
}
