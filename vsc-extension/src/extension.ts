import * as vscode from "vscode";
import { readConfig } from "./config";
import { resolveEndpoint } from "./endpoint";
import { resolveToken } from "./token";
import { ApproverStream } from "./sseClient";
import { PendingRequestsProvider } from "./requestsProvider";
import { patchVerdict, rememberSessionDomain, deleteSession } from "./approverClient";
import { addToDomainList } from "./domainList";
import type { EgressRequest, ResolvedFrame, SnapshotFrame } from "./protocol";

/** The active stream, retained so {@link deactivate} can stop it. */
let stream: ApproverStream | undefined;

/**
 * Claude session ids this window has written policy for. {@link deactivate} issues a
 * best-effort `DELETE /sessions/{id}` for each on shutdown — a courtesy, since a session
 * never outlives its window here; the approver's idle TTL is the real backstop.
 */
const touchedSessions = new Set<string>();

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
    const [endpoint, token] = await Promise.all([
      resolveEndpoint(config),
      resolveToken(config),
    ]);
    await patchVerdict(endpoint, token, request.id, verdict);
  } catch (err) {
    void vscode.window.showErrorMessage(`Egress approver: ${String(err)}`);
  }
}

/**
 * Remember a verdict for the request's Claude session, so the approver auto-settles
 * future egress from that session to this host. No-op (returns false) when the request
 * carries no session id. Surfaces errors via a notification.
 *
 * @param policy The verdict to remember for `(sessionId, host)`.
 * @param request The egress request supplying the session id and host.
 * @returns True when the policy was stored; false on missing session id or error.
 */
async function rememberForSession(
  policy: "allowed" | "denied",
  request: EgressRequest,
): Promise<boolean> {
  const sessionId = request.metadata.sessionId;
  if (!sessionId) return false;
  const config = readConfig();
  try {
    const [endpoint, token] = await Promise.all([
      resolveEndpoint(config),
      resolveToken(config),
    ]);
    await rememberSessionDomain(
      endpoint,
      token,
      sessionId,
      request.metadata.host,
      policy,
    );
    touchedSessions.add(sessionId);
    return true;
  } catch (err) {
    void vscode.window.showErrorMessage(`Egress approver: ${String(err)}`);
    return false;
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

  output.appendLine(
    `${ts()} [init] container=${config.containerName || "(token-pinned)"} endpoint=${config.endpoint || "(discover via docker port)"}`,
  );

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
    () => resolveEndpoint(config),
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
          .showInformationMessage(`Egress: ${label}`, "Allow", "Deny", "All options")
          .then(async (choice) => {
            if (!choice) return;
            if (choice === "All options") {
              await vscode.commands.executeCommand("egressApprover.allOptions", request);
              return;
            }
            await issueVerdict(choice === "Allow" ? "allowed" : "denied", request);
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
    vscode.commands.registerCommand(
      "egressApprover.alwaysAllowRequest",
      async (request: EgressRequest): Promise<void> => {
        const written = await addToDomainList(request.metadata.host, "allowed", output);
        if (written) await issueVerdict("allowed", request);
      },
    ),
    vscode.commands.registerCommand(
      "egressApprover.alwaysDenyRequest",
      async (request: EgressRequest): Promise<void> => {
        const written = await addToDomainList(request.metadata.host, "denied", output);
        if (written) await issueVerdict("denied", request);
      },
    ),
    vscode.commands.registerCommand(
      "egressApprover.allOptions",
      async (request: EgressRequest): Promise<void> => {
        type Action =
          | { kind: "verdict"; verdict: "allowed" | "denied" }
          | { kind: "session"; verdict: "allowed" | "denied" }
          | { kind: "always"; verdict: "allowed" | "denied"; list: "allowed" | "denied" };
        const items: (vscode.QuickPickItem & { action: Action })[] = [
          { label: "$(check) Allow", action: { kind: "verdict", verdict: "allowed" } },
          { label: "$(close) Deny", action: { kind: "verdict", verdict: "denied" } },
        ];
        // Session-scoped options only when the request is attributed to a Claude session.
        if (request.metadata.sessionId) {
          items.push(
            { label: "$(check-all) Allow for this session", action: { kind: "session", verdict: "allowed" } },
            { label: "$(circle-slash) Deny for this session", action: { kind: "session", verdict: "denied" } },
          );
        }
        items.push(
          { label: "$(pass-filled) Always Allow", action: { kind: "always", verdict: "allowed", list: "allowed" } },
          { label: "$(error) Always Deny", action: { kind: "always", verdict: "denied", list: "denied" } },
        );
        const choice = await vscode.window.showQuickPick(items, {
          placeHolder: `Action for ${request.metadata.host}`,
        });
        if (!choice) return;
        if (choice.action.kind === "always") {
          const written = await addToDomainList(request.metadata.host, choice.action.list, output);
          if (!written) return;
        } else if (choice.action.kind === "session") {
          const remembered = await rememberForSession(choice.action.verdict, request);
          if (!remembered) return;
        }
        await issueVerdict(choice.action.verdict, request);
      },
    ),
  );
}

/**
 * Extension teardown: stop the stream, then best-effort forget any sessions this
 * window granted policy to. The deletes are a courtesy — a session never outlives its
 * window here, and the approver's idle TTL reaps anything this misses (async budget,
 * crash). Errors are swallowed for that reason.
 */
export async function deactivate(): Promise<void> {
  stream?.stop();
  stream = undefined;

  if (touchedSessions.size === 0) return;
  const config = readConfig();
  try {
    const [endpoint, token] = await Promise.all([
      resolveEndpoint(config),
      resolveToken(config),
    ]);
    await Promise.allSettled(
      Array.from(touchedSessions, (id) => deleteSession(endpoint, token, id)),
    );
  } catch {
    // Best-effort only; the approver's idle TTL is the real backstop.
  }
  touchedSessions.clear();
}
