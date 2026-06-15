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
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Egress Approver");
  context.subscriptions.push(output);

  const config = readConfig();
  output.appendLine(`[init] endpoint=${config.endpoint}`);

  const client = new ApproverStream(
    config.endpoint,
    () => resolveToken(config),
    {
      onSnapshot: (frame: SnapshotFrame): void =>
        output.appendLine(`[snapshot] ${frame.requests.length} pending`),
      onAdded: (request: EgressRequest): void =>
        output.appendLine(
          `[added] ${request.id} ${request.metadata.method} ${request.metadata.url || request.metadata.host}`,
        ),
      onResolved: (frame: ResolvedFrame): void =>
        output.appendLine(`[resolved] ${frame.id} ${frame.status}`),
      onStatus: (status: string): void =>
        output.appendLine(`[status] ${status}`),
    },
  );
  stream = client;
  client.start();
  context.subscriptions.push({ dispose: (): void => client.stop() });

  context.subscriptions.push(
    vscode.commands.registerCommand("egressApprover.reconnect", (): void => {
      output.appendLine("[command] reconnect");
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
