import { useEffect, useState } from "react";
import { listWorktreeStatuses, type WorktreeStatus } from "../lib/worktreeStatuses.ts";
import { logError } from "../lib/log.ts";

/** How often to recompute worktree statuses, in milliseconds. Matches useRepoSummaries's poll rate. */
const POLL_INTERVAL_MS = 3000;

/**
 * Polls {@link listWorktreeStatuses} on an interval.
 * @returns The most recent statuses (empty until the first poll resolves).
 */
export function useWorktreeStatuses(): readonly WorktreeStatus[] {
    const [statuses, setStatuses] = useState<readonly WorktreeStatus[]>([]);

    useEffect((): (() => void) => {
        let isCancelled = false;

        const poll = (): void => {
            listWorktreeStatuses()
                .then((result): void => {
                    if (!isCancelled) {
                        setStatuses(result);
                    }
                })
                .catch((error: unknown): void => {
                    logError("useWorktreeStatuses", error);
                });
        };

        poll();
        const interval = setInterval(poll, POLL_INTERVAL_MS);
        return (): void => {
            isCancelled = true;
            clearInterval(interval);
        };
    }, []);

    return statuses;
}
