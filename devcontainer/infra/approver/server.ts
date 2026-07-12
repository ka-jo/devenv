/**
 * Egress approval broker entrypoint. Implements the pinned protocol in PROTOCOL.md.
 *
 * Squid's external_acl helper submits egress requests via `POST /requests` and blocks
 * until a terminal verdict is reached. The host-side VS Code extension observes pending
 * requests via `GET /requests` (SSE stream or JSON snapshot), issues verdicts via
 * `PATCH /requests/{id}`, manages durable firewall policies via `POST /policies`, manages
 * per-session policy via `/sessions/{id}`, and retrieves the token out-of-band from tmpfs.
 *
 * The approver is the policy engine: `POST /requests` short-circuits to a remembered
 * verdict when `(sessionId, host)` matches stored session policy, never prompting a human.
 *
 * This file is wiring only: config bootstrap, store construction, and the route table.
 * Request validation lives in the controllers; lifecycle state (and its own background
 * reaper) lives in the stores.
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import { PORT, persistTokenIfGenerated } from "./core/config.ts";
import { withAuth } from "./core/http.ts";
import { createRequestController } from "./controllers/request-controller.ts";
import { createPolicyController } from "./controllers/policy-controller.ts";
import { createSessionController } from "./controllers/session-controller.ts";
import { InMemoryRequestStore } from "./data/request-store.ts";
import { InMemorySessionStore } from "./data/session-store.ts";
import { FilePolicyStore } from "./data/policy-store.ts";

persistTokenIfGenerated();

// Composition root: the one place concrete store implementations are constructed and meet
// the controllers' interfaces. Swap an implementation here (e.g. a SQLite-backed
// SessionStore, or a fake in tests) and no controller changes.
const requestStore = new InMemoryRequestStore();
const sessionStore = new InMemorySessionStore();
const policyStore = new FilePolicyStore();

const requestController = createRequestController(requestStore, sessionStore);
const sessionController = createSessionController(sessionStore);
const policyController = createPolicyController(policyStore);

Bun.serve({
  port: PORT,
  maxRequestBodySize: 64 * 1024,
  routes: {
    "/health": new Response("OK"),
    // POST /requests is intentionally NOT token-gated: it is the proxy helper's call.
    "/requests": {
      POST: requestController.postRequests,
      GET: withAuth(requestController.getRequests),
    },
    "/requests/:id": {
      GET: withAuth(requestController.getRequest),
      PATCH: withAuth(requestController.patchRequest),
    },
    "/policies": {
      POST: withAuth(policyController.postPolicy),
    },
    "/sessions/:id": {
      POST: withAuth(sessionController.postSession),
      GET: withAuth(sessionController.getSession),
      DELETE: withAuth(sessionController.deleteSession),
    },
    "/sessions/:id/policies/:host": {
      POST: withAuth(sessionController.postSessionPolicy),
      GET: withAuth(sessionController.getSessionPolicy),
      DELETE: withAuth(sessionController.deleteSessionPolicy),
    },
    "/*": new Response("not found", { status: 404 }),
  },
  error(err: Error): Response {
    console.error(err);
    return Response.json({ error: "internal server error" }, { status: 500 });
  },
});

console.log(`approver listening on :${PORT}`);
