import { useSyncExternalStore } from "react";
import { getDashboardState, subscribeToDashboardState, type DashboardState } from "../state/store.ts";

/**
 * Subscribes to the dashboard store's live snapshot ({@link getDashboardState}), re-rendering
 * the caller on every refresh.
 * @returns The store's current snapshot.
 */
export function useDashboardState(): DashboardState {
    return useSyncExternalStore(subscribeToDashboardState, getDashboardState);
}
