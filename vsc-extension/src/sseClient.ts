import {
  isEgressRequest,
  isResolvedFrame,
  isSnapshotFrame,
  type EgressRequest,
  type ResolvedFrame,
  type SnapshotFrame,
} from "./protocol";

/** Initial reconnect delay, doubled on each failure up to {@link MAX_BACKOFF_MS}. */
const INITIAL_BACKOFF_MS = 500;
/** Ceiling for the reconnect backoff. */
const MAX_BACKOFF_MS = 10_000;

/** Callbacks the stream invokes for each parsed lifecycle frame plus status changes. */
export interface StreamHandlers {
  /** Full pending set, emitted once per (re)connect. */
  onSnapshot(frame: SnapshotFrame): void;
  /** A request entered `pending`. */
  onAdded(request: EgressRequest): void;
  /** A request left `pending` (verdict or expiry). */
  onResolved(frame: ResolvedFrame): void;
  /** Human-readable connection status / diagnostics. */
  onStatus(status: string): void;
}

/**
 * Long-lived consumer of the approver's `GET /requests` SSE stream.
 *
 * Holds the connection in the extension host (Node), authenticating with the
 * `x-approver-token` header — the browser `EventSource` limitation does not apply
 * here. On any disconnect it redials with exponential backoff and re-resolves the
 * token (which rotates per container start); the server's `snapshot` frame closes
 * any gap, so no `Last-Event-ID` is needed.
 */
export class ApproverStream {
  /** Per-connect endpoint resolver (re-resolves the container's ephemeral port). */
  private readonly resolveEndpoint: () => Promise<string>;
  /** Per-connect token resolver. */
  private readonly resolveToken: () => Promise<string>;
  /** Frame/status callbacks. */
  private readonly handlers: StreamHandlers;
  /** Aborts the in-flight fetch on {@link stop} or reconnect. */
  private controller: AbortController | null = null;
  /** When true, the reconnect loop exits instead of redialing. */
  private stopped = false;
  /** Current backoff delay; reset to {@link INITIAL_BACKOFF_MS} on a clean connect. */
  private backoffMs = INITIAL_BACKOFF_MS;

  /**
   * @param resolveEndpoint Async provider of the approver base URL, called per connect.
   * @param resolveToken Async provider of the current token, called per connect.
   * @param handlers Frame and status callbacks.
   */
  public constructor(
    resolveEndpoint: () => Promise<string>,
    resolveToken: () => Promise<string>,
    handlers: StreamHandlers,
  ) {
    this.resolveEndpoint = resolveEndpoint;
    this.resolveToken = resolveToken;
    this.handlers = handlers;
  }

  /** Begin (or resume) the connect/reconnect loop. Idempotent if already running. */
  public start(): void {
    this.stopped = false;
    void this.connectLoop();
  }

  /** Stop the loop and abort any in-flight connection. */
  public stop(): void {
    this.stopped = true;
    this.controller?.abort();
    this.controller = null;
  }

  /** Drive connect attempts until {@link stop}, backing off between failures. */
  private async connectLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.connectOnce();
      } catch (err) {
        if (this.stopped) break;
        this.handlers.onStatus(`disconnected: ${String(err)}`);
      }
      if (this.stopped) break;
      await delay(this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  /**
   * Open one stream and pump frames until it ends or errors.
   * @throws {Error} On non-OK status, a missing body, or a transport failure.
   */
  private async connectOnce(): Promise<void> {
    const endpoint = await this.resolveEndpoint();
    const token = await this.resolveToken();
    const controller = new AbortController();
    this.controller = controller;

    const res = await fetch(`${endpoint}/requests`, {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        "x-approver-token": token,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error("response has no body");

    this.backoffMs = INITIAL_BACKOFF_MS;
    this.handlers.onStatus("connected");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = this.drainFrames(buffer);
    }
  }

  /**
   * Dispatch every complete `\n\n`-terminated frame in `buffer`.
   * @param buffer Accumulated, partially-decoded stream text.
   * @returns The unconsumed remainder (an incomplete trailing frame).
   */
  private drainFrames(buffer: string): string {
    let rest = buffer.replace(/\r\n/g, "\n");
    let idx = rest.indexOf("\n\n");
    while (idx !== -1) {
      this.dispatchBlock(rest.slice(0, idx));
      rest = rest.slice(idx + 2);
      idx = rest.indexOf("\n\n");
    }
    return rest;
  }

  /**
   * Parse one SSE block into its event type and data, then route it.
   * Comment lines (`:` prefix, e.g. keepalive) and data-less blocks are ignored.
   * @param block One frame's text, without the terminating blank line.
   */
  private dispatchBlock(block: string): void {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).replace(/^ /, ""));
      }
    }
    if (dataLines.length === 0) return;
    this.routeEvent(event, dataLines.join("\n"));
  }

  /**
   * Decode and validate a frame's JSON payload, then invoke the matching handler.
   * Unknown event types and malformed payloads are reported via `onStatus`, never thrown.
   * @param event The SSE event type.
   * @param data The raw JSON data string.
   */
  private routeEvent(event: string, data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.handlers.onStatus(`malformed ${event} payload`);
      return;
    }

    switch (event) {
      case "snapshot":
        if (isSnapshotFrame(parsed)) this.handlers.onSnapshot(parsed);
        else this.handlers.onStatus("invalid snapshot frame");
        break;
      case "added":
        if (isEgressRequest(parsed)) this.handlers.onAdded(parsed);
        else this.handlers.onStatus("invalid added frame");
        break;
      case "resolved":
        if (isResolvedFrame(parsed)) this.handlers.onResolved(parsed);
        else this.handlers.onStatus("invalid resolved frame");
        break;
      default:
        this.handlers.onStatus(`unknown event: ${event}`);
    }
  }
}

/**
 * Resolve after `ms` milliseconds.
 * @param ms Delay in milliseconds.
 * @returns A promise that settles after the delay.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
