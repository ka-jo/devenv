import * as vscode from "vscode";
import { readConfig } from "./config";
import { resolveToken } from "./token";
import { ApproverStream } from "./sseClient";
import { PendingRequestsProvider } from "./requestsProvider";
import { patchVerdict } from "./approverClient";
import type { EgressRequest, ResolvedFrame, SnapshotFrame } from "./protocol";

/** The active stream, retained so {@link deactivate} can stop it. */
let stream: ApproverStream | undefined;

/** Return the current local time as `HH:MM:SS` for log prefixes. */
function ts(): string {
  return new Date().toTimeString().slice(0, 8);
}

/**
 * Issue a verdict for a pending request, resolving the token fresh.
 * Surfaces errors to the user via an error notification.
 *
 * @param verdict The terminal state to apply.
 * @param request The egress request to settle.
 */
async function issueVerdict(
  verdict: "allowed" | "denied",
  request: EgressRequest,
): Promise<void> {
  const config = readConfig();
  try {
    const token = await resolveToken(config);
    await patchVerdict(config.endpoint, token, request.id, verdict);
  } catch (err) {
    void vscode.window.showErrorMessage(`Egress approver: ${String(err)}`);
  }
}

/**
 * Extension entry point. Opens the approver SSE stream and exposes:
 * - A sidebar tree view of pending egress requests with inline Allow/Deny buttons.
 * - An info notification per new request with Allow/Deny actions.
 * - A status bar badge showing pending count.
 * - Output channel for stream lifecycle diagnostics.
 *
 * @param context The extension context for registering disposables.
 */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Egress Approver");
  context.subscriptions.push(output);

  const config = readConfig();

  // Stay dormant unless this window is a devenv dev container. `devenv
  // devcontainer` injects `egressApprover.containerName` into the dev
  // container's workspace settings, so its presence is how a host-side UI
  // extension instance tells "I'm the window attached to an approver-backed
  // container" from "I'm a plain host window." A pinned `token` is the dev
  // escape hatch (fixed endpoint, no container discovery). Without either,
  // do nothing: no stream, no docker shell-outs, no errors about a container
  // that doesn't exist. This is what scopes prompts to the right window —
  // every other window simply never connects.
  if (!config.containerName && !config.token) {
    output.appendLine(
      `${ts()} [init] no egressApprover.containerName/token — dormant (not a dev container window)`,
    );
    return;
  }

  output.appendLine(`${ts()} [init] endpoint=${config.endpoint}`);

  const provider = new PendingRequestsProvider();
  const treeView = vscode.window.createTreeView("egressApprover.requests", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    90,
  );
  statusBar.command = "egressApprover.requests.focus";
  context.subscriptions.push(statusBar);

  /** Sync the status bar badge and visibility with the current pending count. */
  function updateStatusBar(): void {
    const n = provider.size;
    if (n === 0) {
      statusBar.hide();
    } else {
      statusBar.text = `$(shield) ${n} egress`;
      statusBar.tooltip = `${n} egress request${n === 1 ? "" : "s"} pending — click to show`;
      statusBar.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
      statusBar.show();
    }
  }

  const client = new ApproverStream(
    config.endpoint,
    () => resolveToken(config),
    {
      onSnapshot: (frame: SnapshotFrame): void => {
        output.appendLine(
          `${ts()} [snapshot] ${frame.requests.length} pending`,
        );
        provider.setSnapshot(frame.requests);
        updateStatusBar();
      },
      onAdded: (request: EgressRequest): void => {
        output.appendLine(
          `${ts()} [added] ${request.id} ${request.metadata.method} ${request.metadata.url || request.metadata.host}`,
        );
        provider.add(request);
        updateStatusBar();

        // Notify immediately — the Squid helper is blocking until a verdict lands.
        const label = `${request.metadata.method || "CONNECT"} ${request.metadata.host}`;
        void vscode.window
          .showInformationMessage(`Egress: ${label}`, "Allow", "Deny")
          .then(async (choice) => {
            if (!choice) return;
            await issueVerdict(
              choice === "Allow" ? "allowed" : "denied",
              request,
            );
          });
      },
      onResolved: (frame: ResolvedFrame): void => {
        output.appendLine(`${ts()} [resolved] ${frame.id} ${frame.status}`);
        provider.remove(frame.id);
        updateStatusBar();
      },
      onStatus: (status: string): void =>
        output.appendLine(`${ts()} [status] ${status}`),
    },
  );
  stream = client;
  client.start();
  context.subscriptions.push({ dispose: (): void => client.stop() });

  context.subscriptions.push(
    vscode.commands.registerCommand("egressApprover.reconnect", (): void => {
      output.appendLine(`${ts()} [command] reconnect`);
      client.stop();
      client.start();
    }),
    vscode.commands.registerCommand("egressApprover.showLog", (): void =>
      output.show(),
    ),
    vscode.commands.registerCommand(
      "egressApprover.allowRequest",
      async (request: EgressRequest): Promise<void> => {
        await issueVerdict("allowed", request);
      },
    ),
    vscode.commands.registerCommand(
      "egressApprover.denyRequest",
      async (request: EgressRequest): Promise<void> => {
        await issueVerdict("denied", request);
      },
    ),
  );
}

/** Extension teardown: stop the stream and abort any in-flight connection. */
export function deactivate(): void {
  stream?.stop();
  stream = undefined;
}
