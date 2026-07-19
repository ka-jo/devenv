import { useState } from "react";
import type { JSX } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import type { Instance } from "ink";
import { PromptBar } from "./components/PromptBar.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { useRepoSummaries } from "./hooks/useRepoSummaries.ts";
import { useTerminalSize } from "./hooks/useTerminalSize.ts";
import { logError } from "./lib/log.ts";
import { runCommand } from "./lib/runCommand.ts";

/** Whether the prompt bar is idle or capturing a `/`-triggered command. */
type Mode = "normal" | "command";

let instance: Instance;

/** (Re)mounts the dashboard as a fresh Ink instance. */
function renderApp(): Instance {
    return render(<App />, { alternateScreen: true });
}

/** Hands the real terminal to a devenv subcommand, then remounts Ink. */
async function handleRunCommand(command: string, args: readonly string[]): Promise<void> {
    // Full unmount, not just deactivating useInput — Ink ties raw-mode/stdin-flowing
    // to whether any hook is active, and runCommand needs undisputed stdin control.
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
 * Root component: sidebar + content area above a pinned prompt bar.
 * @returns The rendered dashboard.
 */
export function App(): JSX.Element {
    const { exit } = useApp();
    const { rows } = useTerminalSize();
    const [mode, setMode] = useState<Mode>("normal");
    const summaries = useRepoSummaries();
    const [selectedRepo, setSelectedRepo] = useState<string | undefined>(undefined);

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
            <Box flexGrow={1} flexDirection="row">
                <Sidebar summaries={summaries} isFocused={mode === "normal"} onSelectRepo={setSelectedRepo} />
                <Box flexGrow={1} alignItems="center" justifyContent="center">
                    <Text dimColor>{selectedRepo ? `${selectedRepo} — grid lands in a later milestone` : "All repos — grid lands in a later milestone"}</Text>
                </Box>
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
