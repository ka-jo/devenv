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
 * @returns The current size, re-rendering the caller on resize.
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
