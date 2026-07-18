# Delete Server Design

**Date:** 2026-07-18
**Status:** Approved

## Goal

Complete the Delete Server capability in MVP Phase 1. An authenticated
administrator can permanently remove a saved server after confirming the
action. Deletion is rejected while any SSH terminal session for that server is
active. Existing create, list, and terminal behavior remains backward
compatible.

## Scope

This phase includes:

- Delete one saved server by ID.
- Require an explicit confirmation in the Server List UI.
- Reject deletion while the server has an active or connecting terminal
  reservation for any actor.
- Delete the encrypted credential through the existing SQLite foreign-key
  cascade.
- Record sanitized success and failure audit events.
- Remove the deleted row from the current UI without a full-page reload.

This phase excludes bulk deletion, soft deletion, restore, retention policies,
scheduled deletion, automatic terminal disconnection, team ownership, and
cross-instance session coordination.

## Selected Architecture

The API adds this authenticated endpoint:

```text
DELETE /api/v1/servers/:serverId
```

The endpoint requires the new `servers:delete` permission and returns `204 No
Content` after a successful deletion. The service layer owns the active-session
guard and deletion workflow. `ServerRepository` owns an atomic transaction that
deletes the server and inserts the success audit event.

The MVP remains a single API process. One `TerminalSessionManager` instance is
created in `server.ts` and shared by the terminal WebSocket route and the delete
service. This makes the in-memory session reservation the authoritative source
for the active-session guard without adding a second state store.

## Components

### Shared error contract

`ApiErrorCode` gains:

```text
SERVER_HAS_ACTIVE_SESSION
```

The new code is returned with HTTP 409. Existing `SERVER_NOT_FOUND` is returned
with HTTP 404. A successful 204 response has no JSON body and needs no new DTO.

### Session manager

`TerminalSessionManager` adds a read-only query that reports whether a server ID
is reserved by any actor. Both connecting and established sessions count as
active because a reservation is acquired before credential decryption and SSH
network I/O.

The query does not expose session IDs, actors, credentials, or mutable internal
collections. Existing reservation limits and idempotent release behavior remain
unchanged.

### Delete service

`DeleteServerService` receives narrow dependencies for:

- The active-session query.
- Atomic repository deletion with success audit.
- Failure audit persistence.
- ID and clock generation for deterministic tests.

The service executes synchronously because the session check and SQLite
transaction must run without yielding to another event-loop task between them.
It checks the server reservation first. If active, it records a best-effort
failure audit and throws `SERVER_HAS_ACTIVE_SESSION`.

If no reservation exists, the repository transaction attempts the deletion. A
zero-row result becomes `SERVER_NOT_FOUND`; the service records a best-effort
failure audit. Unexpected errors are mapped to `INTERNAL_ERROR` without exposing
database details.

### Repository transaction

`ServerRepository.deleteWithAudit` uses a prepared server delete statement and
the existing sanitized audit serialization. Within one SQLite transaction it:

1. Deletes the row from `servers` by ID.
2. Returns a not-found result when no row changed and inserts no success audit.
3. Relies on `server_credentials.server_id ON DELETE CASCADE` to delete the
   encrypted credential.
4. Inserts `server.delete` success audit data when exactly one row changed.

The audit table has no foreign key to `servers`, so the audit record remains
after the server is removed. A transaction failure rolls back both the server
deletion and success audit insertion.

### HTTP route and permission

`registerServerRoute` accepts an optional delete executor without changing the
existing create/list executors. The route validates `serverId` as a bounded,
non-empty string and requires `servers:delete`.

The existing global Origin check covers DELETE requests. The existing HttpOnly
JWT cookie authenticates the request. The response schema documents 204, 401,
403, 404, 409, and 500 outcomes.

### Frontend

`ApiClient.deleteServer(serverId)` sends an encoded DELETE request with
credentials and uses the existing strict API error parser. A successful 204 is
handled without attempting to parse JSON.

Each Server List row gains a trash icon button with an accessible label and
tooltip. Selecting it opens one page-level confirmation dialog that shows the
server name and endpoint. The destructive action is disabled while its request
is pending, and Cancel leaves state unchanged.

After a successful 204, the row is removed from the local list. On
`SERVER_HAS_ACTIVE_SESSION`, the dialog remains available and the UI displays a
concise instruction to disconnect the terminal first. Authentication failure
continues to return the user to login. Other stable API messages are displayed
without stack traces or secret data.

## Delete Flow

1. The administrator selects Delete on a Server List row.
2. The UI opens the confirmation dialog for that exact server.
3. Confirmation sends the same-origin DELETE request with the JWT cookie.
4. Fastify validates Origin, JWT, permission, and server ID.
5. The delete service checks the shared session manager across all actors.
6. If active, the API records a sanitized failure audit and returns 409 without
   changing the database or terminal.
7. If inactive, the repository transaction deletes the server and credential
   and records a success audit.
8. The API returns 204 and the frontend removes the row.

## Errors

- `SERVER_NOT_FOUND` (404): the ID does not identify a saved server.
- `SERVER_HAS_ACTIVE_SESSION` (409): an active or connecting terminal must be
  disconnected before deletion.
- `UNAUTHENTICATED` (401): the JWT cookie is absent, invalid, or expired.
- `FORBIDDEN` (403): Origin or permission validation failed.
- `INTERNAL_ERROR` (500): persistence or other unexpected processing failed.

The API never includes SQL errors, credentials, host keys, session IDs, or actor
details in the response.

## Audit

The API records `server.delete` with target type `server` and the requested
server ID.

- Success is inserted atomically with the delete and contains
  `{ resource: "server" }`.
- Failure contains `{ resource: "server", errorCode }` and is best effort so an
  audit persistence failure cannot replace the stable original error.

No password, private key, passphrase, encrypted credential, host key, terminal
content, or raw request payload is audited.

## Testing

Unit and integration tests cover:

- Active-session lookup across actors and release behavior.
- Service rejection before repository deletion when a session is active.
- Not-found, success, and unexpected repository failure mappings.
- Atomic server, credential, and success-audit deletion behavior.
- JWT, Origin, `servers:delete`, parameter validation, and 204 responses.
- Sanitized success and failure audit metadata.
- API client handling for 204 and stable errors.
- Confirmation, cancel, pending, success, active-session error, and
  authentication-expiry UI behavior.

Playwright creates a server, verifies that deletion is blocked while its
terminal is active, disconnects the terminal, deletes the server, and confirms
that it no longer appears. Final verification runs Prettier, ESLint, TypeScript
strict checks, all Vitest suites, Playwright desktop/mobile coverage, production
builds, Docker Compose health checks, authenticated login, and WebSocket smoke
tests.

## Backward Compatibility

The endpoint, permission, error code, executor dependency, session query, API
client method, and UI control are additive. Existing create, list, SSH terminal,
database schema, public server DTOs, environment variables, and Docker defaults
remain unchanged. No database migration is required.
