# Egress Approver (VS Code extension)

Host-side approval UI for the dev container egress firewall. Consumes the approver
sidecar's `GET /requests` SSE stream and (eventually) lets you allow/deny pending
egress requests via `PATCH /requests/{id}`.

See the contract in `../devcontainer/approver/PROTOCOL.md`.

## Why it runs on the host

`extensionKind` is `["ui"]` — this extension **must** run on the local machine, not
in the dev container:

- the approver is published only to host loopback (`127.0.0.1:3129`);
- the token is retrieved via a host `docker compose exec`;
- the sandboxed app container has no route to the approver by design.

## Develop

```sh
npm install
npm run build        # or: npm run watch
npm run typecheck
```

Then press **F5** in VS Code to launch an Extension Development Host.

### Dev loop without the full stack

Run the approver standalone with a pinned token, simulate the proxy helper with
`curl`, and point the extension at it:

```sh
# in devcontainer/approver
APPROVER_TOKEN=dev bun server.ts

# simulate a pending request (blocks until decided)
curl -s -XPOST localhost:3129/requests \
  -H 'content-type: application/json' \
  -d '{"host":"example.com","method":"GET","url":"http://example.com/x"}'
```

Set `egressApprover.token` to `dev` so the extension skips the `docker compose exec`
retrieval. Open **Output → Egress Approver** to watch frames.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `egressApprover.endpoint` | `http://127.0.0.1:3129` | Approver base URL. |
| `egressApprover.token` | `""` | Dev-only pinned token; empty = retrieve from container. |
| `egressApprover.dockerComposeFile` | `""` | Compose file for token retrieval; empty = `<workspace>/.devcontainer/docker-compose.yml`. |
