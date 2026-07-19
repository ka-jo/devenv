import { useEffect, useState } from "react";
import { listRepoSummaries, type RepoSummary } from "../lib/repoSummaries.ts";
import { logError } from "../lib/log.ts";

/** How often to recompute repo summaries, in milliseconds. */
// Wider than a plain fs scan needs — each poll fans out a docker ps + docker compose exec
// per running worktree container.
const POLL_INTERVAL_MS = 3000;

/**
 * Polls {@link listRepoSummaries} on an interval.
 * @returns The most recent summaries (empty until the first poll resolves).
 */
export function useRepoSummaries(): readonly RepoSummary[] {
    const [summaries, setSummaries] = useState<readonly RepoSummary[]>([]);

    useEffect((): (() => void) => {
        let isCancelled = false;

        const poll = (): void => {
            listRepoSummaries()
                .then((result): void => {
                    if (!isCancelled) {
                        setSummaries(result);
                    }
                })
                .catch((error: unknown): void => {
                    logError("useRepoSummaries", error);
                });
        };

        poll();
        const interval = setInterval(poll, POLL_INTERVAL_MS);
        return (): void => {
            isCancelled = true;
            clearInterval(interval);
        };
    }, []);

    return summaries;
}
