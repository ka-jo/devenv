import type { JSX, ReactNode } from "react";
import { Box, Text } from "ink";

/** Cells consumed by everything but the title and trailing dashes in `╭─ TITLE ─...─╮`: `╭`, `─`, two spaces, `╮`. */
const TITLE_LINE_CHROME_WIDTH = 5;

/** Props for {@link TitledBox}. */
export interface TitledBoxProps {
    /** Label rendered inline in the top border. */
    readonly title: string;
    /** Fixed width of the box, in terminal cells (border included). */
    readonly width: number;
    /** Whether this box is the focused region — highlights the border. */
    readonly isFocused?: boolean;
    /** Passed through to the outer `Box` so the box can grow to fill remaining vertical space in a column layout. */
    readonly flexGrow?: number;
    /** Gap to the next box, in terminal cells. */
    readonly marginRight?: number;
    readonly children: ReactNode;
}

/**
 * A rounded-border box with its title embedded in the top border line.
 * @param props - See {@link TitledBoxProps}.
 * @returns The rendered box.
 * @remarks
 * Ink's `Box` has no built-in support for a titled border, so the top edge is hand-built as a
 * `Text` line and stacked above a `Box` with `borderTop={false}` — the left/right verticals of
 * that `Box` line up under the fabricated top line as long as both share `width`.
 */
export function TitledBox({ title, width, isFocused = false, flexGrow, marginRight, children }: TitledBoxProps): JSX.Element {
    const borderColor = isFocused ? "redBright" : undefined;
    return (
        <Box flexDirection="column" width={width} flexGrow={flexGrow} marginRight={marginRight}>
            <Text color={borderColor} wrap="truncate-end">
                {buildTitleLine(title, width)}
            </Text>
            <Box flexDirection="column" width={width} flexGrow={1} borderStyle="round" borderTop={false} borderColor={borderColor} paddingX={1}>
                {children}
            </Box>
        </Box>
    );
}

/** Builds the top border line, e.g. `"╭─ WORKTREES ────────╮"`, padded out to `width`. */
function buildTitleLine(title: string, width: number): string {
    const dashCount = Math.max(0, width - TITLE_LINE_CHROME_WIDTH - title.length);
    return `╭─ ${title} ${"─".repeat(dashCount)}╮`;
}
