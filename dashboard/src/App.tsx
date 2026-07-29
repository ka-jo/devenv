import { useMemo, useState } from "react";
import type { JSX } from "react";
import { Box, render, useApp, useInput } from "ink";
import type { Instance } from "ink";
import { AgentDetail } from "./components/AgentDetail.tsx";
import { ContainerDetail } from "./components/ContainerDetail.tsx";
import { PromptBar } from "./components/PromptBar.tsx";
import { WorktreeList, type FocusedPane } from "./components/WorktreeList.tsx";
import { useDashboardState } from "./hooks/useDashboardState.ts";
import { useTerminalSize } from "./hooks/useTerminalSize.ts";
import { logError } from "./lib/log.ts";
import { runCommand } from "./lib/runCommand.ts";
import { selectWorktreeStatuses, type WorktreeStatus } from "./state/selectors/worktreeStatuses.ts";
import { refreshDashboardState } from "./state/store.ts";

/** Whether the prompt bar is idle or capturing a `/`-triggered command. */
type Mode = "normal" | "command";

let instance: Instance;

/** (Re)mounts the dashboard as a fresh Ink instance. */
function renderApp(): Instance {
  return render(<App />, { alternateScreen: true });
}

/** Hands the real terminal to a devenv subcommand, then remounts Ink. */
async function handleRunCommand(
  command: string,
  args: readonly string[],
): Promise<void> {
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
 * Root component: worktree list + detail column above a pinned prompt bar.
 * @returns The rendered dashboard.
 */
export function App(): JSX.Element {
  const { exit } = useApp();
  const { rows } = useTerminalSize();
  const [mode, setMode] = useState<Mode>("normal");
  const state = useDashboardState();
  const cards = useMemo((): WorktreeStatus[] => selectWorktreeStatuses(state), [state]);
  const [focusedCard, setFocusedCard] = useState<WorktreeStatus | undefined>(undefined);
  const [focusedPane, setFocusedPane] = useState<FocusedPane>("list");
  const [focusedAgentIndex, setFocusedAgentIndex] = useState<number | undefined>(undefined);

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
    const args = command
      .trim()
      .split(/\s+/)
      .filter((arg): boolean => arg.length > 0);
    if (args.length === 0) {
      return;
    }
    if (args[0] === "bg") {
      if (focusedCard === undefined) {
        return;
      }
      const name = `dash-${Date.now().toString(36)}`;
      const promptWords = args.slice(1);
      void (async (): Promise<void> => {
        await handleRunCommand(command, ["agent", "up", focusedCard.repo, focusedCard.branch, name, "--", ...promptWords]);
        await refreshDashboardState();
      })();
      return;
    }
    void handleRunCommand(command, args);
  };
  const handleCancel = (): void => setMode("normal");

  const handleAttachAgent = (repo: string, branch: string, agentId: string): void => {
    void (async (): Promise<void> => {
      await handleRunCommand(`agent attach ${repo} ${branch}`, ["agent", "attach", repo, branch, `--id=${agentId}`]);
      await refreshDashboardState();
    })();
  };

  return (
    <Box flexDirection="column" width="100%" height={rows}>
      <Box flexGrow={1} flexDirection="row">
        <WorktreeList
          isActive={mode === "normal"}
          cards={cards}
          onFocusedCardChange={setFocusedCard}
          onFocusedPaneChange={setFocusedPane}
          onFocusedAgentIndexChange={setFocusedAgentIndex}
          onAttachAgent={handleAttachAgent}
        />
        <Box flexDirection="column">
          <ContainerDetail card={focusedCard} isFocused={focusedPane === "container"} />
          <AgentDetail card={focusedCard} isFocused={focusedPane === "agents"} focusedAgentIndex={focusedAgentIndex} />
        </Box>
      </Box>
      <PromptBar
        isActive={mode === "command"}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
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
