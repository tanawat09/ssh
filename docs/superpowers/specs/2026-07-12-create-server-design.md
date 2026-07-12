# Create Server Design

## Scope

This design covers the first Web Remote Platform feature: creating an SSH server definition after successfully testing its credentials. The workspace starts empty, so this feature also establishes the minimum monorepo structure required by the approved technology stack.

Included:

- Single-admin login backed by environment configuration
- JWT authentication and `servers:create` permission validation
- Server creation using password or private-key authentication
- Optional private-key passphrase
- SSH authentication test before persistence
- Trust On First Use (TOFU) host-key capture
- Credential encryption at rest
- Audit logging for successful and failed attempts

Excluded:

- Server list and deletion
- Interactive terminal and session management
- SFTP, RDP, VNC, MFA, teams, port forwarding, and other future features

## Requirements

The create form accepts:

- Name
- Host name or IP address
- Port
- SSH username
- Authentication type
- Password, or private key with an optional passphrase

The tuple `(host, port, username)` must be unique. Creation succeeds only when the backend can authenticate to the SSH endpoint with the submitted credentials. The API never returns stored credentials.

## Architecture

Use an npm-workspaces TypeScript monorepo:

```text
apps/
  web/       Vue 3, Vite, Pinia, Vue Router, TailwindCSS
  api/       Fastify, JWT, ssh2, SQLite
packages/
  shared/    Request/response schemas, DTOs, and error codes
tests/
  e2e/       Playwright user flows
```

The request path is:

```text
Browser -> Vue application -> Fastify route -> application service
        -> SSH gateway / repositories -> SSH endpoint / SQLite
```

Backend responsibilities are separated as follows:

- Routes authenticate requests, enforce permissions, validate schemas, and translate application errors to HTTP responses.
- Services coordinate duplicate detection, SSH testing, encryption, persistence, and audit logging.
- The SSH gateway contains all `ssh2` integration and maps library errors to application errors.
- Repositories isolate SQLite access and transaction behavior.
- The encryption service owns authenticated encryption and secret serialization.
- A composition root constructs concrete dependencies and injects them into routes and services.

No abstraction may include behavior for features outside this scope.

## Authentication And Authorization

`POST /api/v1/auth/login` accepts an admin username and password. The expected username and Argon2id password hash come from `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH`. A plain-text admin password is never stored in source code, environment examples, or SQLite.

A successful login creates a signed JWT containing the admin role. The JWT is delivered through an HttpOnly cookie and is not accessible to frontend JavaScript. Production cookies use `Secure` and `SameSite=Strict`; state-changing routes also validate the request origin. JWT signing material and lifetime are supplied through environment configuration.

The create route requires the `servers:create` permission. The single admin role receives this permission through a centralized permission mapping so future roles do not require route changes. Login attempts are limited to five per source IP in a rolling 15-minute window.

## API Contract

`POST /api/v1/servers` accepts a discriminated request based on `authType`:

- `password`: common server fields plus `password`
- `privateKey`: common server fields plus `privateKey` and optional `passphrase`

The operation proceeds in this order:

1. Authenticate the JWT and require `servers:create`.
2. Validate and normalize the input.
3. Reject an existing `(host, port, username)` tuple.
4. Test SSH authentication within the configured timeout.
5. Accept and capture the first observed host key using TOFU.
6. Encrypt the credential payload with a new IV.
7. Persist the server, encrypted credential, host key, and success audit record in one transaction.
8. Return `201 Created` with a credential-free server DTO.

Proposed error responses:

- `400` for schema validation errors
- `401` for invalid login or JWT authentication
- `403` for missing permission
- `409` for a duplicate SSH endpoint and username
- `422` for invalid SSH credentials or private-key material
- `504` for an SSH connection timeout
- `500` for unexpected encryption or persistence errors

Raw `ssh2`, cryptographic, and database messages are never returned. Stable application error codes allow the frontend to render appropriate messages without depending on implementation details.

The default SSH connection timeout is 10 seconds and may be changed with `SSH_CONNECT_TIMEOUT_MS`. Values outside 1,000 to 60,000 milliseconds fail startup validation. Host names are trimmed, converted to lowercase, and validated as DNS names or IP literals before duplicate detection. Names and usernames are trimmed but retain case.

## Persistence

SQLite contains three tables for this feature.

`servers` stores identity and connection metadata:

- `id`, `name`, `host`, `port`, `username`, `auth_type`
- `host_key_algorithm`, `host_key_fingerprint`, `host_key_base64`
- `created_at`, `updated_at`
- A unique constraint on `host`, `port`, and `username`

`server_credentials` isolates encrypted secrets:

- `server_id`
- `encrypted_payload`, `iv`, `auth_tag`

`audit_logs` stores security events:

- `id`, `action`, `result`, `actor`, `target_type`
- Optional `target_id`, `source_ip`, structured `metadata`, `created_at`

Audit metadata must never contain a password, private key, passphrase, JWT, encryption key, or decrypted payload. Failed SSH tests create a sanitized audit record outside the server-creation transaction because no server row exists to commit.

## Credential Protection

Credential payloads use AES-256-GCM with a fresh unpredictable IV for every encryption. `CREDENTIAL_ENCRYPTION_KEY` supplies exactly 32 bytes encoded as Base64. The application fails startup when required secrets are absent or malformed.

Credentials remain in process memory only for validation, the SSH test, and encryption. Logging configuration redacts secret field names. The decrypted credential is never exposed through repository read models intended for API responses.

The host public key is not a credential secret. The system stores its algorithm, SHA-256 fingerprint, and Base64 key material so later SSH sessions can reject a changed key.

TOFU does not protect the first connection from a man-in-the-middle attack. This is an accepted MVP risk. Every first-use acceptance is recorded in the audit metadata, and later host-key mismatches must be rejected.

## Frontend Behavior

Unauthenticated users see the admin login page. After login, users reach the Create Server page.

The form uses a segmented control to select password or private-key authentication and only renders fields relevant to that selection. Password and passphrase controls include icon-based show/hide actions. The private key uses a multiline secure input.

The primary command is `Test & Save`. While it runs, the form prevents duplicate submission and communicates the connection state without resizing the layout. Field validation appears next to the relevant control; SSH, timeout, and unexpected errors appear at form level.

On success, the page displays the saved non-secret server data and captured host-key fingerprint. It does not navigate to a server-list feature that is outside this scope. On failure, general connection fields remain populated, while password, private key, and passphrase values are cleared.

Pinia stores only non-secret session state. It does not store the JWT or SSH credentials.

## Failure Handling

- Duplicate detection occurs before network access.
- Every SSH client is closed on success, error, or timeout.
- SSH timeout and authentication failure are distinct application errors.
- Encryption occurs only after SSH authentication succeeds.
- Transaction failure cannot leave a server without its credential or host key.
- A failed create attempt records a sanitized audit event without persisting server credentials.
- Expired authentication returns the frontend to login without retaining secret form fields.

## Testing

Vitest covers:

- Shared validation for both authentication variants
- Encryption round trips and authentication-tag tamper detection
- Permission enforcement and error mapping
- Repository uniqueness and transaction rollback
- Service behavior for successful SSH tests, authentication failures, and timeouts
- Frontend conditional fields, validation, secret clearing, and submission states

Backend integration tests cover login, authorization, duplicate detection, successful creation, SSH failure, timeout, audit behavior, and response redaction. The SSH gateway is injected and replaced by a deterministic test implementation; automated tests do not require a real remote SSH server.

Playwright covers the browser login and the successful and failed `Test & Save` flows using the test gateway.

Completion requires strict TypeScript checks, ESLint, Vitest, Playwright, and production builds to pass. Docker images and Docker Compose startup must also be verified.

## Deployment

Web and API applications receive separate Dockerfiles and run through Docker Compose. Runtime secrets are injected through environment variables and are not embedded in images. The frontend and API are exposed through a same-origin arrangement so HttpOnly cookie authentication and origin checks behave consistently.

SQLite data and required runtime state use named volumes. Container health checks must distinguish an available process from external SSH endpoint availability.

## Compatibility And Future Evolution

There is no existing runtime behavior to preserve because the workspace began empty. Versioned `/api/v1` routes and credential-free DTOs establish a backward-compatible surface for the remaining MVP features.

Repository and service interfaces allow SQLite to be replaced by PostgreSQL later without changing routes. The stored host-key fields support future SSH sessions, while fingerprint confirmation can be added later without changing existing server records.

This design intentionally does not create generalized implementations for teams, SFTP, terminal sessions, jump hosts, or other future requirements.
