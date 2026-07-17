import { useState } from "react";
import type { JSX } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import type { Instance } from "ink";
import { PromptBar } from "./components/PromptBar.tsx";
import { useTerminalSize } from "./hooks/useTerminalSize.ts";
import { logError } from "./lib/log.ts";
import { runCommand } from "./lib/runCommand.ts";

/** Whether the prompt bar is idle or capturing a `/`-triggered command. */
type Mode = "normal" | "command";

let instance: Instance;

/**
 * (Re)mounts the dashboard. Ink owns the alternate-screen buffer, cursor
 * visibility, and raw mode for as long as this instance is mounted.
 *
 * @returns The new Ink instance.
 */
function renderApp(): Instance {
    return render(<App />, { alternateScreen: true });
}

/**
 * Hands the real terminal to a devenv subcommand.
 *
 * Ink must be fully unmounted first — not just have its `useInput` hooks
 * deactivated — since Ink ties raw-mode/stdin-flowing state to whether any
 * hook is active, and {@link runCommand} needs undisputed control of stdin
 * for its own manual bridging.
 *
 * @param command - The command text as typed, for the echoed prompt line.
 * @param args - Arguments to pass to the `devenv` binary (already split).
 */
async function handleRunCommand(command: string, args: readonly string[]): Promise<void> {
    instance.unmount();
    await instance.waitUntilExit();

    try {
        await runCommand(command, args);
    } catch (error) {
        logError("runCommand", error);
    }

    instance = renderApp();
}

/**
 * Root component of the devenv dashboard: a full-screen layout with a
 * content area above and a prompt bar pinned to the bottom.
 *
 * Owns only the `mode` flag — cross-cutting state that determines which
 * region's `useInput` handler is active (see {@link PromptBar} for the
 * text-editing state, which is local to it).
 *
 * @returns The rendered dashboard.
 */
export function App(): JSX.Element {
    const { exit } = useApp();
    const { rows } = useTerminalSize();
    const [mode, setMode] = useState<Mode>("normal");

    useInput(
        (input, key): void => {
            if (input === "q" && !key.ctrl && !key.meta) {
                exit();
            } else if (input === "/") {
                setMode("command");
            }
        },
        { isActive: mode === "normal" },
    );

    const handleSubmit = (command: string): void => {
        setMode("normal");
        const args = command.trim().split(/\s+/).filter((arg): boolean => arg.length > 0);
        if (args.length === 0) {
            return;
        }
        void handleRunCommand(command, args);
    };
    const handleCancel = (): void => setMode("normal");

    return (
        <Box flexDirection="column" width="100%" height={rows}>
            <Box flexGrow={1} alignItems="center" justifyContent="center">
                <Text dimColor>devenv dashboard — sidebar/grid land in later milestones</Text>
            </Box>
            <PromptBar isActive={mode === "command"} onSubmit={handleSubmit} onCancel={handleCancel} />
        </Box>
    );
}

process.on("uncaughtException", (error: unknown) => {
    logError("uncaughtException", error);
    process.exit(1);
});
process.on("unhandledRejection", (error: unknown) => {
    logError("unhandledRejection", error);
});

instance = renderApp();
