# Web Terminal Multi-Session Design

**Date:** 2026-07-17
**Status:** Approved

## Goal

Add an authenticated browser SSH terminal to MVP Phase 1. An administrator can
open terminals to multiple saved servers, switch between terminal tabs, and
disconnect each session explicitly. The existing create-server and list-server
flows remain backward compatible.

## Scope

This phase includes:

- Open an interactive SSH shell for a saved server.
- Render the shell with xterm.js in the browser.
- Keep at most five active terminal sessions for the administrator.
- Prevent a second active session to the same saved server.
- Switch between active sessions with terminal tabs.
- Resize the remote PTY when the visible terminal changes size.
- Disconnect when requested, when the browser WebSocket closes, or when the SSH
  channel closes.
- Record connection success, failure, and disconnect audit events without
  terminal content or secrets.

This phase excludes delete-server, SFTP, RDP, VNC, port forwarding, jump hosts,
session recording, command history, session resume, MFA, and team access.

## Selected Architecture

Each terminal tab owns one WebSocket connection and one SSH client/channel. The
WebSocket endpoint is:

```text
GET /api/v1/servers/:serverId/terminal
```

The browser derives `ws:` or `wss:` from `window.location` and sends no token or
credential in the URL. The existing `remote_session` HttpOnly JWT cookie
authenticates the WebSocket upgrade. One connection per tab isolates failures
and cleanup while avoiding a multiplexing protocol that is unnecessary for a
five-session MVP.

The API keeps active session reservations in process memory. This matches the
single API instance used by the MVP. Horizontal scaling and resumable sessions
require an external session coordinator and are explicitly deferred.

## Components

### Shared terminal contract

`packages/shared` defines stable control messages and validates untrusted client
messages. Client-to-server messages are UTF-8 JSON:

```ts
type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'disconnect' }
```

Input is limited to 16 KiB per message. Columns are integers from 20 through
400 and rows are integers from 5 through 200. Unknown keys and message types are
rejected.

Server control messages are UTF-8 JSON:

```ts
type TerminalServerMessage =
  | { type: 'ready'; sessionId: string }
  | { type: 'error'; code: ApiErrorCode; message: string }
  | { type: 'closed'; reason: 'client' | 'ssh' | 'error' }
```

SSH output is sent as binary WebSocket frames and written to xterm.js as
`Uint8Array`. Binary frames avoid corrupting a multi-byte UTF-8 character split
across SSH chunks. The client never sends binary frames.

### Server connection material

`ServerRepository.getConnectionMaterialById` returns the saved endpoint, stored
host key, and encrypted credential only to the API service layer. Public list
DTOs are unchanged and continue to omit these fields. The credential cipher
decrypts the credential immediately before the SSH connection is opened.

### SSH terminal gateway

A dedicated terminal gateway creates an `ssh2` client with the saved endpoint
and credential. Its `hostVerifier` performs an exact constant-time comparison
against the stored raw host key. A missing or changed key rejects the
connection. The gateway requests an `xterm-256color` PTY, initially 80 columns
by 24 rows, exposes input and resize operations, and owns idempotent cleanup for
the SSH channel and client.

### Session manager

`TerminalSessionManager` reserves a session before decryption or network I/O.
Reservations are keyed by actor and server ID and enforce:

- At most five sessions for `admin`.
- At most one active session for each saved server.
- Idempotent release on every termination path.

A reservation is released if lookup, decryption, SSH authentication, host-key
verification, shell creation, WebSocket processing, or audit recording fails.

### WebSocket route

The Fastify WebSocket route registers after `@fastify/websocket` and uses the
existing `servers:connect` permission hook. Because an upgrade is a GET request,
the route independently requires the `Origin` header to exactly equal
`ALLOWED_ORIGIN`.

The WebSocket server disables per-message compression and limits inbound frames
to 64 KiB. It installs message, close, and error handlers synchronously before
starting asynchronous SSH setup. Invalid protocol messages close only that
terminal with a stable error. Secret values and raw internal errors never enter
responses or logs.

SSH output is flow-controlled. The route pauses the SSH channel when the
WebSocket buffered amount exceeds 1 MiB and periodically resumes below 256 KiB.
If the socket cannot drain before its bounded timeout, the session closes rather
than buffering without limit.

### Frontend workspace

The authenticated `/terminals` route uses the approved Terminal Tabs layout:

- A server sidebar shows all saved servers and their connection state.
- A tab strip shows active sessions and a close icon for each session.
- One terminal is visible at a time, while inactive terminal components remain
  mounted so their xterm buffers and WebSockets stay alive.
- A session counter shows the current count out of five.
- Connect is disabled for an already active server and when the cap is reached.
- On narrow screens the sidebar collapses and tabs scroll horizontally.

`@xterm/xterm` renders terminal output. `@xterm/addon-fit` fits the active
terminal and sends debounced resize messages. Closing a tab sends a disconnect
message and closes the socket. Page teardown closes every active socket; there
is no automatic reconnect or resume.

## Connection Flow

1. The administrator selects Connect for a saved server.
2. The terminal store creates a pending tab and opens the same-origin WebSocket.
3. Fastify validates Origin, JWT, permission, server ID, the five-session cap,
   and duplicate-server rule.
4. The API loads encrypted connection material and decrypts it in memory.
5. The SSH gateway validates the stored host key, authenticates, and opens a PTY
   shell.
6. The API sends `ready`; SSH binary output and validated browser input then flow
   in opposite directions.
7. Resize messages update the remote PTY.
8. Any close path tears down the channel/client, releases the reservation, and
   records a sanitized audit event.

## Errors

The shared error contract gains stable codes for server not found, active
duplicate, session limit, host-key mismatch, and invalid terminal protocol.
User-facing messages remain generic for authentication and network failures.
The frontend keeps the failed tab visible with a concise error and a close
action; it does not expose stack traces or retry automatically.

## Audit

The API records:

- `terminal.connect` with `success` after the PTY is ready.
- `terminal.connect` with `failure` for setup failures.
- `terminal.disconnect` with `success` and a sanitized reason when an established
  session ends.

Allowed metadata is limited to `errorCode`, `reason`, and `durationMs` in
addition to the existing allowlist. Terminal input, terminal output, passwords,
private keys, passphrases, decrypted credentials, and raw WebSocket payloads are
never audited.

## Deployment

Nginx forwards WebSocket upgrade headers for `/api/` and uses a long proxy read
timeout suitable for interactive sessions. TLS terminates at the external proxy
as it does today; production browser connections therefore use WSS. Existing
Docker services, health endpoints, persistent SQLite volume, and REST proxy
behavior remain unchanged.

## Testing

Unit and integration tests cover:

- Strict terminal message parsing and bounds.
- Permission, JWT cookie, and exact Origin checks.
- Five-session and duplicate-server enforcement.
- Repository lookup without leaking connection material through public DTOs.
- Credential decryption and exact stored host-key verification.
- Shell input, binary output, resize, backpressure, and idempotent cleanup.
- Sanitized audit metadata for success, failure, and disconnect.
- Frontend tab creation, switching, limit handling, errors, and close behavior.

Playwright extends the local SSH fixture with PTY and shell support. Desktop and
mobile tests create saved servers, open two different terminals, run a command,
switch tabs without losing output, resize, and disconnect. Final verification
runs formatting, lint, TypeScript strict checks, all Vitest suites, Playwright,
production builds, and Docker Compose health checks.

## Backward Compatibility

All existing HTTP routes, request/response DTOs, environment variables,
database tables, and create/list behavior remain unchanged. The WebSocket route,
permission, error codes, dependencies, and UI route are additive. No database
migration is required.
