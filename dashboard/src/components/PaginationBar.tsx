import type { JSX } from "react";
import { Box, Text } from "ink";
import type { GridPageInfo } from "./Grid.tsx";

/** Props for {@link PaginationBar}. */
export interface PaginationBarProps {
    /** Current grid page/selection state, or `undefined` before the grid has reported one. */
    readonly info: GridPageInfo | undefined;
}

/**
 * Plain-text status row directly under the grid: item range on the left, page count on the right.
 * Not interactive — paging is keyboard-only via the grid itself.
 * @param props - See {@link PaginationBarProps}.
 * @returns The rendered bar.
 */
export function PaginationBar({ info }: PaginationBarProps): JSX.Element {
    const range = info === undefined || info.total === 0 ? "No worktrees" : `Showing ${info.start}-${info.end} of ${info.total}`;
    const pages = info === undefined ? "Page 1 of 1" : `Page ${info.page} of ${info.pageCount}`;

    return (
        <Box justifyContent="space-between" paddingX={1}>
            <Text dimColor>{range}</Text>
            <Text dimColor>{pages}</Text>
        </Box>
    );
}
