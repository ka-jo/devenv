import * as vscode from "vscode";
import type { EgressRequest } from "./protocol";

/**
 * Format an epoch-ms timestamp as a short relative age string.
 * @param createdAt Epoch milliseconds when the request entered `pending`.
 * @returns A string like `"5s ago"` or `"2m ago"`.
 */
function formatAge(createdAt: number): string {
  const secs = Math.floor((Date.now() - createdAt) / 1000);
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

/**
 * Flat `TreeDataProvider` exposing the live set of pending egress requests.
 *
 * Mutated by the extension via {@link setSnapshot}, {@link add}, and {@link remove};
 * each mutation fires `onDidChangeTreeData` so VS Code refreshes the view.
 */
export class PendingRequestsProvider
  implements vscode.TreeDataProvider<EgressRequest>
{
  /** @internal */
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<EgressRequest | undefined | void>();

  /** Emits when the tree data changes; consumed by the VS Code tree view. */
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Live pending set, keyed by request id. */
  private readonly _requests = new Map<string, EgressRequest>();

  /**
   * Replace the entire pending set from a snapshot frame.
   * @param requests The full current pending list.
   */
  public setSnapshot(requests: EgressRequest[]): void {
    this._requests.clear();
    for (const r of requests) this._requests.set(r.id, r);
    this._onDidChangeTreeData.fire();
  }

  /**
   * Add one request from an `added` frame.
   * @param request The newly-pending egress request.
   */
  public add(request: EgressRequest): void {
    this._requests.set(request.id, request);
    this._onDidChangeTreeData.fire();
  }

  /**
   * Remove a request that reached a terminal state.
   * @param id UUID of the resolved request.
   */
  public remove(id: string): void {
    if (this._requests.delete(id)) this._onDidChangeTreeData.fire();
  }

  /** Number of currently-pending requests. */
  public get size(): number {
    return this._requests.size;
  }

  /**
   * Return root-level elements (this tree is intentionally flat).
   * @param element Present only for child lookups; always returns `[]` when defined.
   * @returns Pending requests sorted oldest-first, or `[]` for child lookups.
   */
  public getChildren(element?: EgressRequest): EgressRequest[] {
    if (element !== undefined) return [];
    return [...this._requests.values()].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
  }

  /**
   * Build a {@link vscode.TreeItem} for a pending request.
   *
   * Sets `contextValue = "pendingRequest"` so the Allow/Deny inline buttons
   * declared in `package.json` `view/item/context` menus are rendered.
   *
   * @param element The egress request to render.
   * @returns A tree item showing method + target with an age description.
   */
  public getTreeItem(element: EgressRequest): vscode.TreeItem {
    const method = element.metadata.method || "CONNECT";
    const target = element.metadata.url || element.metadata.host;
    const item = new vscode.TreeItem(
      `${method} ${target}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = element.id;
    item.description = formatAge(element.createdAt);
    item.iconPath = new vscode.ThemeIcon("shield");
    item.contextValue = "pendingRequest";

    const sessionLine = element.metadata.sessionId
      ? `\n\nsession: \`${element.metadata.sessionId}\``
      : "";
    item.tooltip = new vscode.MarkdownString(
      `**${method}** \`${target}\`\n\nid: \`${element.id}\`${sessionLine}`,
    );
    return item;
  }
}
