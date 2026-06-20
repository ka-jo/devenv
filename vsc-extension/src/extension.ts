import * as vscode from "vscode";
import { readConfig } from "./config";
import { resolveToken } from "./token";
import { ApproverStream } from "./sseClient";
import type { EgressRequest, ResolvedFrame, SnapshotFrame } from "./protocol";

/** The active stream, retained so {@link deactivate} can stop it. */
let stream: ApproverStream | undefined;

/**
 * Extension entry point. Opens the approver SSE stream and logs lifecycle frames
 * to an output channel — the bare host→approver channel, ahead of any UI.
 * @param context The extension context for registering disposables.
 */
/** Return the current local time as `HH:MM:SS` for log prefixes. */
function ts(): string {
  return new Date().toTimeString().slice(0, 8);
}

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

  const client = new ApproverStream(
    config.endpoint,
    () => resolveToken(config),
    {
      onSnapshot: (frame: SnapshotFrame): void =>
        output.appendLine(`${ts()} [snapshot] ${frame.requests.length} pending`),
      onAdded: (request: EgressRequest): void =>
        output.appendLine(
          `${ts()} [added] ${request.id} ${request.metadata.method} ${request.metadata.url || request.metadata.host}`,
        ),
      onResolved: (frame: ResolvedFrame): void =>
        output.appendLine(`${ts()} [resolved] ${frame.id} ${frame.status}`),
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
  );
}

/** Extension teardown: stop the stream and abort any in-flight connection. */
export function deactivate(): void {
  stream?.stop();
  stream = undefined;
}
