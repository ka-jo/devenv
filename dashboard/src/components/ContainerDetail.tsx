import type { JSX } from "react";
import { Box, Text } from "ink";
import type { ContainerStatus } from "../state/sources/containers.ts";
import type { WorktreeStatus } from "../state/selectors/worktreeStatuses.ts";
import { TitledBox } from "./TitledBox.tsx";

/** Fixed width of the detail column's boxes, in terminal cells (border included). */
export const DETAIL_WIDTH = 40;
/** Fixed height of the container box's content: status line + meta line. */
const CONTAINER_DETAIL_HEIGHT = 2;

/** Glyph/color/label for one raw {@link ContainerStatus} — deliberately not agent-aware, unlike {@link WorktreeList}'s aggregated status column. */
const CONTAINER_STATUS_DISPLAY: Record<ContainerStatus, { readonly glyph: string; readonly color: string | undefined; readonly label: string }> = {
    running: { glyph: "●", color: "green", label: "Running" },
    error: { glyph: "■", color: "redBright", label: "Error" },
    stopped: { glyph: "○", color: undefined, label: "Stopped" },
};

/** Props for {@link ContainerDetail}. */
export interface ContainerDetailProps {
    /** The currently-focused worktree row, or `undefined` if the list is empty. */
    readonly card: WorktreeStatus | undefined;
    /** Whether the container pane currently owns keyboard focus. */
    readonly isFocused: boolean;
}

/**
 * Detail box showing the focused worktree's container health, independent of its agents' state.
 * @param props - See {@link ContainerDetailProps}.
 * @returns The rendered box.
 */
export function ContainerDetail({ card, isFocused }: ContainerDetailProps): JSX.Element {
    const title = card === undefined ? "CONTAINER" : `CONTAINER — ${card.repo}/${card.branch}`;

    if (card === undefined) {
        return (
            <TitledBox title={title} width={DETAIL_WIDTH} isFocused={isFocused}>
                <Text dimColor>No worktree selected</Text>
            </TitledBox>
        );
    }

    const { glyph, color, label } = CONTAINER_STATUS_DISPLAY[card.containerStatus];
    const meta =
        card.containerStatus === "running"
            ? `up ${card.uptime ?? "?"}`
            : card.containerStatus === "error"
              ? "exited"
              : "—";

    return (
        <TitledBox title={title} width={DETAIL_WIDTH} isFocused={isFocused}>
            <Box flexDirection="column" height={CONTAINER_DETAIL_HEIGHT}>
                <Text color={color}>{`${glyph} ${label}   container ${card.containerId ?? "?"}`}</Text>
                <Text dimColor>{meta}</Text>
            </Box>
        </TitledBox>
    );
}
