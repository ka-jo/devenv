import { useEffect, useState } from "react";
import { useStdout } from "ink";

/** Current terminal dimensions, in columns/rows. */
export interface TerminalSize {
    /** Terminal width in columns. */
    readonly columns: number;
    /** Terminal height in rows. */
    readonly rows: number;
}

/**
 * Tracks the terminal's live dimensions, updating on resize.
 *
 * Ink only binds width to the terminal automatically — height must be sized
 * explicitly (e.g. a root `<Box height={rows}>`) for a full-screen layout to
 * actually fill the terminal and pin content (like a bottom bar) in place.
 *
 * @returns The current terminal size; re-renders the caller on resize.
 */
export function useTerminalSize(): TerminalSize {
    const { stdout } = useStdout();
    const [size, setSize] = useState<TerminalSize>({
        columns: stdout.columns,
        rows: stdout.rows,
    });

    useEffect((): (() => void) => {
        const onResize = (): void => {
            setSize({ columns: stdout.columns, rows: stdout.rows });
        };
        stdout.on("resize", onResize);
        return (): void => {
            stdout.off("resize", onResize);
        };
    }, [stdout]);

    return size;
}
