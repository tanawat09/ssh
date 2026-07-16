# List Server Design

## Scope

Add the read-only server listing capability for MVP Phase 1. Every successful
and failed list request creates a `server.list` audit event. No credentials,
private keys, encrypted payloads, or host-key material are returned to the
client or written to audit metadata.

## API and Security

- Add `GET /api/v1/servers`.
- Require the existing `servers:read` permission.
- Return an array of the existing `ServerDto` contract.
- Preserve the existing authentication, origin, error, and cookie behavior.
- Return a generic internal error response; database details stay server-side.
- Record one audit event per request with action `server.list`, actor `admin`,
  source IP when available, result `success` or `failure`, and metadata limited
  to the requested resource type and returned item count when successful.

## Persistence

- Add `ServerRepository.listAll()` selecting only public server columns.
- Order results by `created_at ASC` for deterministic display.
- Keep credentials and host-key bytes out of the query.
- Add an `AuditRepository` helper for list events if it removes duplication
  without changing existing repository contracts.

## Frontend

- Add an authenticated `/servers` route and make `/` redirect there.
- Add a `ServerListView` with loading, empty, error, and populated states.
- Display name, endpoint, authentication type, host-key algorithm, fingerprint,
  and timestamps using existing visual conventions.
- Add navigation to `/servers/new` for Create Server.
- On `401`, reuse the existing session redirect behavior.
- Do not add delete, terminal, SFTP, pagination, search, or client-side secret
  storage.

## Testing

- API tests cover permission enforcement, deterministic ordering, DTO field
  safety, success audit count/metadata, and failure audit behavior.
- Repository tests cover empty and populated results and exclude credential data.
- Frontend tests cover loading, empty, populated, error, and unauthorized
  states.
- Run the full lint, typecheck, unit, build, and existing E2E gates before
  delivery.

## Compatibility and Risks

The existing `ServerDto` remains unchanged. The new endpoint is additive. Audit
volume increases because every list request is recorded; metadata remains
bounded and secret-free. Pagination is intentionally deferred until a concrete
scale requirement exists.
