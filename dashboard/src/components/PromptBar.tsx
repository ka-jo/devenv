import { useState } from "react";
import type { JSX } from "react";
import { Box, Text, useInput } from "ink";

const HINTS = "↑↓←→ move   PgUp/PgDn page   ⏎ open   / command   q quit";
const IDLE_HINT = "press / to enter a command";

/** Props for {@link PromptBar}. */
export interface PromptBarProps {
    /** Whether the bar is capturing keystrokes (i.e. command mode is on). */
    readonly isActive: boolean;
    /** Called with the finished command text when the user presses Enter. */
    readonly onSubmit: (command: string) => void;
    /** Called when the user cancels out of command mode via Escape. */
    readonly onCancel: () => void;
}

/**
 * Bottom command bar: `devenv ›` prompt plus text input, or a dim hint when idle.
 * @param props - See {@link PromptBarProps}.
 * @returns The rendered prompt bar.
 */
export function PromptBar({ isActive, onSubmit, onCancel }: PromptBarProps): JSX.Element {
    const [text, setText] = useState<string>("");
    const [cursor, setCursor] = useState<number>(0);

    useInput(
        (input, key): void => {
            if (key.escape) {
                setText("");
                setCursor(0);
                onCancel();
            } else if (key.return) {
                const submitted = text;
                setText("");
                setCursor(0);
                onSubmit(submitted);
            } else if (key.leftArrow) {
                setCursor((c): number => Math.max(0, c - 1));
            } else if (key.rightArrow) {
                setCursor((c): number => Math.min(text.length, c + 1));
            } else if (key.backspace) {
                if (cursor === 0) {
                    return;
                }
                setText((t): string => t.slice(0, cursor - 1) + t.slice(cursor));
                setCursor((c): number => c - 1);
            } else if (key.delete) {
                setText((t): string => t.slice(0, cursor) + t.slice(cursor + 1));
            } else if (input && !key.ctrl && !key.meta) {
                setText((t): string => t.slice(0, cursor) + input + t.slice(cursor));
                setCursor((c): number => c + input.length);
            }
        },
        { isActive },
    );

    return (
        <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingX={1} justifyContent="space-between">
            <Text>
                <Text color="redBright">devenv › </Text>
                {isActive ? (
                    <Text>
                        <Text>{text.slice(0, cursor)}</Text>
                        <Text inverse>{cursor < text.length ? text[cursor] : " "}</Text>
                        <Text>{text.slice(cursor + 1)}</Text>
                    </Text>
                ) : (
                    <Text dimColor>{IDLE_HINT}</Text>
                )}
            </Text>
            <Text dimColor>{HINTS}</Text>
        </Box>
    );
}
