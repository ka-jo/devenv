/**
 * Server-sent-events hub for the `GET /requests` stream. Owns the set of live
 * stream controllers and the frame serialization, so the request store can
 * broadcast lifecycle changes without knowing about transport details. A dead
 * controller (enqueue throws) is dropped silently and broadcasting continues.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import type { EgressRequest } from "../types/egress-request.ts";
import type { ResolvedFrame } from "../types/resolved-frame.ts";

/** Reusable encoder for SSE frame serialization. @internal */
const encoder: TextEncoder = new TextEncoder();

/** Set of SSE stream controllers for broadcasting. Cleaned up on client disconnect. */
export const streamControllers = new Set<
  ReadableStreamDefaultController<Uint8Array>
>();

/**
 * Safely encode and send an SSE frame to a stream controller.
 * If the controller's connection is dead (enqueue throws), removes it from
 * {@link streamControllers} and suppresses the error to allow broadcasting to continue.
 * @param controller The stream controller to write to.
 * @param event The event type.
 * @param data The JSON data payload.
 */
export function emitSseFrame(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
): void {
  const encoded: Uint8Array = encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
  try {
    controller.enqueue(encoded);
  } catch {
    // Client disconnected; remove from broadcasters and continue.
    streamControllers.delete(controller);
  }
}

/**
 * Safely emit a raw SSE keepalive comment to a stream controller.
 * If the controller's connection is dead, removes it from {@link streamControllers}
 * and suppresses the error.
 * @param controller The stream controller to write to.
 */
export function emitSseKeepalive(
  controller: ReadableStreamDefaultController<Uint8Array>,
): void {
  const keepaliveEncoded: Uint8Array = encoder.encode(": keepalive\n\n");
  try {
    controller.enqueue(keepaliveEncoded);
  } catch {
    // Client disconnected; remove from broadcasters and continue.
    streamControllers.delete(controller);
  }
}

/**
 * Send a resolved frame (lean delta) to all connected SSE subscribers.
 * If a subscriber's connection is dead, silently removes it and continues.
 * @param frame The resolved frame data.
 */
export function broadcastResolved(frame: ResolvedFrame): void {
  for (const controller of streamControllers) {
    emitSseFrame(controller, "resolved", frame);
  }
}

/**
 * Send an added frame to all connected SSE subscribers.
 * If a subscriber's connection is dead, silently removes it and continues.
 * @param request The newly-created pending request.
 */
export function broadcastAdded(request: EgressRequest): void {
  for (const controller of streamControllers) {
    emitSseFrame(controller, "added", request);
  }
}
