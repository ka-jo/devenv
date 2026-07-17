import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Path of the dashboard's own error log — outside the alt-screen buffer, so it survives crashes the terminal doesn't. */
export const LOG_PATH = join(tmpdir(), "devenv-dashboard.log");

/**
 * Appends a timestamped error entry to {@link LOG_PATH}.
 *
 * @param context - Short label for where the error was caught.
 * @param error - The caught value (may not be an `Error` instance).
 */
export function logError(context: string, error: unknown): void {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${context}: ${detail}\n`);
}

/**
 * Appends a timestamped diagnostic entry to {@link LOG_PATH} — for tracing
 * control flow (e.g. subprocess lifecycle), not for caught errors.
 *
 * @param context - Short label for where this trace point is.
 * @param message - Free-form diagnostic detail.
 */
export function logDebug(context: string, message: string): void {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${context}: ${message}\n`);
}
