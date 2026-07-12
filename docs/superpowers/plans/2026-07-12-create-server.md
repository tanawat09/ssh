# Create Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser workflow that authenticates one environment-configured administrator, tests password or private-key SSH credentials, and securely persists a unique server definition only after successful authentication.

**Architecture:** Use an npm-workspaces monorepo with Vue in `apps/web`, Fastify in `apps/api`, and runtime-safe TypeBox contracts in `packages/shared`. Fastify routes delegate to injected services; services coordinate an `ssh2` gateway, AES-256-GCM encryption, and SQLite repositories. The browser receives JWT authentication only through an HttpOnly cookie.

**Tech Stack:** Vue 3, TypeScript strict mode, Vite, Pinia, Vue Router, TailwindCSS, Fastify, WebSocket-ready Fastify composition, ssh2, better-sqlite3, Argon2id, TypeBox, Vitest, Playwright, ESLint, Prettier, Docker, Docker Compose

## Global Constraints

- Implement only Admin Login and Create Server; do not implement List/Delete Server, Terminal, Session, SFTP, RDP, VNC, MFA, Team, or Port Forwarding behavior.
- Use TypeScript strict mode and do not use `any`, dead code, or duplicated business rules.
- Never store plain-text passwords, private keys, passphrases, JWTs, or encryption keys.
- Never return or log SSH credentials or raw infrastructure errors.
- Require a unique normalized `(host, port, username)` tuple.
- Test SSH authentication before encryption and persistence.
- Accept the first host key using TOFU, store it, audit it, and document the accepted first-connection MITM risk.
- Preserve the versioned `/api/v1` contract for later MVP features.
- Every task must pass its focused tests before commit; final delivery requires lint, typecheck, unit/integration tests, Playwright, production builds, and Docker Compose verification.

---

## File Map

### Workspace And Shared Contracts

- `package.json`: npm workspace commands and Node engine floor.
- `tsconfig.base.json`: strict shared TypeScript settings.
- `eslint.config.js`, `.prettierrc.json`, `.gitignore`: repository quality and generated-file rules.
- `packages/shared/src/server-contract.ts`: Create Server schemas and DTO types.
- `packages/shared/src/auth-contract.ts`: Login/session schemas and DTO types.
- `packages/shared/src/api-error.ts`: stable public error codes and envelope.
- `packages/shared/src/index.ts`: explicit public exports.

### API

- `apps/api/src/config.ts`: validated environment configuration.
- `apps/api/src/app.ts`: Fastify composition root; accepts injected SSH gateway and database.
- `apps/api/src/server.ts`: production process startup and shutdown.
- `apps/api/src/domain/application-error.ts`: typed internal failures.
- `apps/api/src/security/credential-cipher.ts`: AES-256-GCM boundary.
- `apps/api/src/security/permissions.ts`: role-to-permission mapping and guard.
- `apps/api/src/auth/auth-route.ts`: rate-limited login and JWT cookie issuance.
- `apps/api/src/servers/ssh-gateway.ts`: SSH interface, ssh2 adapter, timeout cleanup, and host-key capture.
- `apps/api/src/servers/create-server-service.ts`: Create Server orchestration.
- `apps/api/src/servers/server-route.ts`: protected HTTP contract.
- `apps/api/src/database/database.ts`: SQLite connection and migrations.
- `apps/api/src/database/server-repository.ts`: uniqueness and atomic create persistence.
- `apps/api/src/database/audit-repository.ts`: sanitized failure audit persistence.
- `apps/api/src/database/migrations/001_create_server.sql`: initial schema.

### Web

- `apps/web/src/main.ts`, `App.vue`, `router.ts`: Vue bootstrap and route guard.
- `apps/web/src/lib/api-client.ts`: same-origin, credentialed API calls and typed errors.
- `apps/web/src/stores/session.ts`: non-secret session state.
- `apps/web/src/views/LoginView.vue`: admin login.
- `apps/web/src/views/CreateServerView.vue`: conditional Create Server form and result.
- `apps/web/src/components/SecretInput.vue`: accessible show/hide secret control.
- `apps/web/src/style.css`: Tailwind import and restrained application tokens.

### Deployment And End-To-End Tests

- `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/web/nginx.conf`: production images and same-origin `/api` proxy.
- `compose.yaml`, `.env.example`: runtime topology and secret names without secret values.
- `playwright.config.ts`: browser projects and test harness.
- `tests/e2e/create-server.spec.ts`: login and Test & Save flows.
- `tests/e2e/fixtures/ssh-server.ts`: ephemeral local SSH server with runtime-generated keys.

---

### Task 1: Workspace And Runtime-Safe Shared Contracts

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.gitignore`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/auth-contract.ts`, `packages/shared/src/server-contract.ts`, `packages/shared/src/api-error.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/server-contract.test.ts`

**Interfaces:**
- Produces: `LoginRequestSchema`, `SessionDtoSchema`, `CreateServerRequestSchema`, `ServerDtoSchema`, `ApiErrorSchema`, and their TypeBox `Static<>` types.
- `CreateServerRequest` is a union discriminated by `authType: "password" | "privateKey"`.

- [ ] **Step 1: Add workspace metadata and install only the dependencies required by the first shared-contract test**

Run:

```bash
npm init -y
npm pkg set private=true --json
npm pkg set 'workspaces[0]=apps/*' 'workspaces[1]=packages/*'
mkdir -p packages/shared/src
cd packages/shared && npm init -y
cd ../..
npm pkg set name=@remote/shared type=module -w packages/shared
npm install -w @remote/shared @sinclair/typebox
npm install -D -w @remote/shared typescript vitest
npm install -D eslint @eslint/js typescript-eslint prettier
```

Expected: root and shared `package.json` files exist and `package-lock.json` pins resolved versions. Configure `@remote/shared` to expose `dist/index.js` plus `dist/index.d.ts`.

- [ ] **Step 2: Write failing schema tests**

Create tests that compile `CreateServerRequestSchema` with `TypeCompiler.Compile()` and assert:

```ts
expect(check.Check({
  name: 'Production', host: 'server.example.com', port: 22,
  username: 'deploy', authType: 'password', password: 'secret'
})).toBe(true)
expect(check.Check({
  name: 'Production', host: 'server.example.com', port: 22,
  username: 'deploy', authType: 'privateKey', privateKey: 'pem', passphrase: 'secret'
})).toBe(true)
expect(check.Check({
  name: 'Production', host: 'server.example.com', port: 0,
  username: 'deploy', authType: 'password', password: 'secret'
})).toBe(false)
expect(check.Check({
  name: 'Production', host: 'server.example.com', port: 22,
  username: 'deploy', authType: 'password', privateKey: 'pem'
})).toBe(false)
```

- [ ] **Step 3: Verify the tests fail before schemas exist**

Run: `npm test -w @remote/shared`

Expected: FAIL because `CreateServerRequestSchema` is not exported.

- [ ] **Step 4: Implement schemas and stable error codes**

Use `Type.Object(..., { additionalProperties: false })`, `Type.Union` for the two credential variants, port bounds `1..65535`, and non-empty bounded strings. Define these exact public codes:

```ts
export const ApiErrorCode = {
  INVALID_REQUEST: 'INVALID_REQUEST', UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN', SERVER_ALREADY_EXISTS: 'SERVER_ALREADY_EXISTS',
  SSH_AUTHENTICATION_FAILED: 'SSH_AUTHENTICATION_FAILED',
  SSH_CONNECTION_FAILED: 'SSH_CONNECTION_FAILED', SSH_TIMEOUT: 'SSH_TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
} as const
export type ApiErrorCode = typeof ApiErrorCode[keyof typeof ApiErrorCode]
```

`ServerDto` must contain `id`, `name`, `host`, `port`, `username`, `authType`, `hostKeyAlgorithm`, `hostKeyFingerprint`, and ISO timestamps, with no credential fields.

- [ ] **Step 5: Run shared checks and commit**

Run: `npm test -w @remote/shared && npm run typecheck -w @remote/shared`

Expected: all schema tests PASS and TypeScript reports no errors.

Commit:

```bash
git add package.json package-lock.json tsconfig.base.json eslint.config.js .prettierrc.json .gitignore packages/shared
git commit -m "feat: add shared API contracts"
```

### Task 2: Validated API Configuration And SQLite Foundation

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/database/database.ts`
- Create: `apps/api/src/database/migrations/001_create_server.sql`
- Test: `apps/api/src/config.test.ts`, `apps/api/src/database/database.test.ts`

**Interfaces:**
- Produces: `AppConfig`, `loadConfig(env: NodeJS.ProcessEnv): AppConfig`, `openDatabase(path: string): Database.Database`, and `migrateDatabase(db): void`.
- `AppConfig` exposes `nodeEnv`, parsed values, and a 32-byte `credentialEncryptionKey: Buffer`, never the original Base64 string.

- [ ] **Step 1: Install API persistence and test dependencies**

Run:

```bash
mkdir -p apps/api/src/database/migrations
cd apps/api && npm init -y
cd ../..
npm pkg set name=@remote/api type=module -w apps/api
npm install -w @remote/api @remote/shared fastify better-sqlite3
npm install -D -w @remote/api typescript vitest @types/node @types/better-sqlite3
```

Expected: package manifests and lockfile update successfully.

- [ ] **Step 2: Write failing configuration and migration tests**

Cover missing variables, invalid Base64 key length, SSH timeout below 1,000 or above 60,000, valid config, migration idempotence, and the database foreign-key pragma. Use an in-memory database for migration tests.

```ts
expect(() => loadConfig({})).toThrow('Missing required environment variable')
expect(loadConfig(validEnv).sshConnectTimeoutMs).toBe(10_000)
expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
expect(() => migrateDatabase(db)).not.toThrow()
expect(() => migrateDatabase(db)).not.toThrow()
```

- [ ] **Step 3: Run tests and confirm missing modules fail**

Run: `npm test -w @remote/api -- config.test.ts database.test.ts`

Expected: FAIL because config and database modules do not exist.

- [ ] **Step 4: Implement strict configuration and migration runner**

Require `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `ALLOWED_ORIGIN`, and `DATABASE_PATH`. Default `SSH_CONNECT_TIMEOUT_MS` to `10000`; reject values outside the approved range. Split SQL migration statements only through `better-sqlite3.exec()` and record version `001` in `schema_migrations`.

The SQL must create the three approved tables, foreign keys, check constraints for `auth_type`, the unique server tuple, and indexes for audit time and target lookup. Credential fields must exist only in `server_credentials`.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -w @remote/api -- config.test.ts database.test.ts`

Expected: PASS.

Commit:

```bash
git add package-lock.json apps/api
git commit -m "feat: add API config and database schema"
```

### Task 3: Authenticated Credential Encryption

**Files:**
- Create: `apps/api/src/security/credential-cipher.ts`
- Test: `apps/api/src/security/credential-cipher.test.ts`

**Interfaces:**
- Consumes: `AppConfig.credentialEncryptionKey`.
- Produces: `CredentialCipher.encrypt(credential: ServerCredential): EncryptedCredential` and `decrypt(value): ServerCredential`.
- `ServerCredential` is the same discriminated password/private-key union used by the service, without server metadata.

- [ ] **Step 1: Write failing encryption tests**

Test password and private-key round trips, unique IVs for the same payload, and rejection after changing one byte of ciphertext or the authentication tag.

```ts
const first = cipher.encrypt({ authType: 'password', password: 'secret' })
const second = cipher.encrypt({ authType: 'password', password: 'secret' })
expect(first.iv).not.toBe(second.iv)
expect(cipher.decrypt(first)).toEqual({ authType: 'password', password: 'secret' })
expect(() => cipher.decrypt({ ...first, authTag: mutate(first.authTag) })).toThrow()
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -w @remote/api -- credential-cipher.test.ts`

Expected: FAIL because `CredentialCipher` does not exist.

- [ ] **Step 3: Implement AES-256-GCM with a fresh 12-byte IV**

Use Node `createCipheriv('aes-256-gcm', key, randomBytes(12))`, UTF-8 JSON serialization, explicit credential shape checking after JSON parse, and Base64 database fields. Never accept a key whose decoded size is not 32 bytes.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -w @remote/api -- credential-cipher.test.ts`

Expected: PASS, including tamper rejection.

Commit:

```bash
git add apps/api/src/security
git commit -m "feat: encrypt SSH credentials at rest"
```

### Task 4: Admin Login, JWT Cookie, Origin Check, And Permissions

**Files:**
- Create: `apps/api/src/app.ts`, `apps/api/src/domain/application-error.ts`
- Create: `apps/api/src/auth/auth-route.ts`, `apps/api/src/security/permissions.ts`
- Test: `apps/api/src/auth/auth-route.test.ts`, `apps/api/src/security/permissions.test.ts`

**Interfaces:**
- Produces: `buildApp(options: BuildAppOptions): FastifyInstance` and `requirePermission('servers:create')` pre-handler.
- JWT payload is `{ sub: 'admin', role: 'admin' }`; frontend response is `{ user: { username, role: 'admin' } }`.

- [ ] **Step 1: Install Fastify security plugins and Argon2**

Run:

```bash
npm install -w @remote/api @fastify/cookie @fastify/jwt @fastify/rate-limit argon2
```

Expected: dependencies are locked without peer errors.

- [ ] **Step 2: Write failing route and permission tests**

Use `app.inject()` to verify correct login returns `200` and `Set-Cookie`, wrong login returns generic `401`, the sixth login attempt from one IP returns `429`, a missing cookie is `401`, and an admin JWT passes `servers:create`. Assert response bodies never contain the submitted password or configured hash.

- [ ] **Step 3: Run tests and confirm failure**

Run: `npm test -w @remote/api -- auth-route.test.ts permissions.test.ts`

Expected: FAIL because app composition and routes do not exist.

- [ ] **Step 4: Implement authentication boundaries**

Register cookie, JWT, and rate-limit plugins. Verify passwords with `argon2.verify`, sign the exact payload, and set cookie `remote_session` with `httpOnly: true`, `sameSite: 'strict'`, `path: '/'`, and `secure: config.nodeEnv === 'production'`. Compare state-changing request `Origin` to `ALLOWED_ORIGIN` before route execution. Return only stable `ApiErrorCode` envelopes.

Define permissions without route-specific conditionals:

```ts
const permissionsByRole = {
  admin: new Set<Permission>(['servers:create'])
} satisfies Record<Role, ReadonlySet<Permission>>
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -w @remote/api -- auth-route.test.ts permissions.test.ts`

Expected: PASS.

Commit:

```bash
git add package-lock.json apps/api/src/app.ts apps/api/src/domain apps/api/src/auth apps/api/src/security/permissions.ts
git commit -m "feat: add admin JWT authentication"
```

### Task 5: Server And Audit Repositories

**Files:**
- Create: `apps/api/src/database/server-repository.ts`, `apps/api/src/database/audit-repository.ts`
- Test: `apps/api/src/database/server-repository.test.ts`, `apps/api/src/database/audit-repository.test.ts`

**Interfaces:**
- Produces: `ServerRepository.existsByEndpoint(endpoint): boolean` and `createWithAudit(record, encrypted, event): ServerDto`.
- Produces: `AuditRepository.recordFailure(event): void`.
- Repository inputs contain already normalized public fields and already encrypted credential fields.

- [ ] **Step 1: Write failing repository tests**

Assert case-normalized host uniqueness, port/username tuple behavior, atomic insertion into all three tables, rollback after a forced audit insert failure, and sanitized failure metadata.

```ts
expect(repo.existsByEndpoint({ host: 'server.example.com', port: 22, username: 'deploy' })).toBe(false)
repo.createWithAudit(server, encrypted, successEvent)
expect(repo.existsByEndpoint({ host: 'server.example.com', port: 22, username: 'deploy' })).toBe(true)
expect(db.prepare('select count(*) count from server_credentials').get()).toEqual({ count: 1 })
```

- [ ] **Step 2: Verify tests fail**

Run: `npm test -w @remote/api -- server-repository.test.ts audit-repository.test.ts`

Expected: FAIL because repositories do not exist.

- [ ] **Step 3: Implement prepared statements and one explicit transaction**

Use `db.transaction()` for server, credential, and success-audit inserts. Serialize only an allow-listed metadata object. Map SQLite unique-constraint failures to `SERVER_ALREADY_EXISTS`; do not expose SQL or database paths.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -w @remote/api -- server-repository.test.ts audit-repository.test.ts`

Expected: PASS, including rollback assertions.

Commit:

```bash
git add apps/api/src/database
git commit -m "feat: persist servers and audit events atomically"
```

### Task 6: ssh2 Gateway With TOFU Host-Key Capture

**Files:**
- Create: `apps/api/src/servers/ssh-gateway.ts`
- Test: `apps/api/src/servers/ssh-gateway.test.ts`

**Interfaces:**
- Produces: `SshGateway.testConnection(request, timeoutMs): Promise<VerifiedHostKey>`.
- `VerifiedHostKey` is `{ algorithm: string; fingerprint: string; keyBase64: string }`.
- Gateway errors are `ApplicationError` values using SSH authentication, connection, or timeout codes.

- [ ] **Step 1: Install ssh2 and write failing adapter tests**

Run: `npm install -w @remote/api ssh2 && npm install -D -w @remote/api @types/ssh2`

Test with a local `ssh2.Server` created inside the test: password success, private-key success, bad credential, refused connection, timeout, host-key SHA-256 fingerprint, and client closure for every result.

- [ ] **Step 2: Run tests and verify missing gateway failure**

Run: `npm test -w @remote/api -- ssh-gateway.test.ts`

Expected: FAIL because the gateway is not implemented.

- [ ] **Step 3: Implement the adapter and cleanup**

Wrap `Client` in one Promise with a settlement guard. Capture the raw key in `hostVerifier`, derive the SSH algorithm by length-decoding the first binary string in the key blob, compute `SHA256:<unpadded-base64>`, and accept it for TOFU. Call `client.end()` and clear the timer from a shared `finish()` path. Pass exactly one of `password` or `privateKey`/`passphrase` to ssh2.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -w @remote/api -- ssh-gateway.test.ts`

Expected: PASS with no open-handle warning.

Commit:

```bash
git add package-lock.json apps/api/src/servers/ssh-gateway.ts apps/api/src/servers/ssh-gateway.test.ts
git commit -m "feat: test SSH credentials and capture host keys"
```

### Task 7: Create Server Service And Protected Route

**Files:**
- Create: `apps/api/src/servers/create-server-service.ts`, `apps/api/src/servers/server-route.ts`, `apps/api/src/server.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/servers/create-server-service.test.ts`, `apps/api/src/servers/server-route.test.ts`

**Interfaces:**
- Consumes: shared `CreateServerRequest`, `SshGateway`, `CredentialCipher`, `ServerRepository`, and `AuditRepository`.
- Produces: `CreateServerService.execute(input, context): Promise<ServerDto>` and protected `POST /api/v1/servers`.

- [ ] **Step 1: Write failing orchestration tests**

Assert this exact order with spies: normalize, duplicate check, SSH test, encrypt, atomic create. Assert duplicate requests never call SSH; SSH failures never call encryption or create; every failure writes a sanitized audit event; successful DTOs have no secret keys.

- [ ] **Step 2: Write failing route integration tests**

Cover `400`, `401`, `403`, `409`, `422`, `504`, and `201`, origin rejection, both credential variants, DTO response schema, and body/log redaction.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npm test -w @remote/api -- create-server-service.test.ts server-route.test.ts`

Expected: FAIL because service and route do not exist.

- [ ] **Step 4: Implement normalization and orchestration**

Use `node:net.isIP` plus a bounded DNS-label validator. Trim and lowercase host; trim name and username without changing their case. Generate IDs with `randomUUID()` and timestamps with an injected clock. Construct audit metadata only from `host`, `port`, `username`, `authType`, error code, and accepted fingerprint.

- [ ] **Step 5: Register the protected route and production entry point**

Attach shared TypeBox request/response schemas, permission pre-handler, and error mapping. `server.ts` loads config, opens/migrates SQLite, builds concrete dependencies, listens only after successful startup validation, and closes Fastify plus SQLite on `SIGINT`/`SIGTERM`.

- [ ] **Step 6: Run all API tests and commit**

Run: `npm test -w @remote/api && npm run typecheck -w @remote/api`

Expected: all API tests PASS with no TypeScript errors.

Commit:

```bash
git add apps/api/src
git commit -m "feat: add protected create server API"
```

### Task 8: Vue Login And Create Server Experience

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/main.ts`, `apps/web/src/App.vue`, `apps/web/src/router.ts`, `apps/web/src/style.css`
- Create: `apps/web/src/lib/api-client.ts`, `apps/web/src/stores/session.ts`
- Create: `apps/web/src/components/SecretInput.vue`
- Create: `apps/web/src/views/LoginView.vue`, `apps/web/src/views/CreateServerView.vue`
- Test: corresponding `*.test.ts` files next to store, component, and views

**Interfaces:**
- Consumes: shared login, error, Create Server, and Server DTO contracts.
- Produces: `/login` and `/servers/new` routes; no server-list route.

- [ ] **Step 1: Scaffold the Vite workspace and install approved UI dependencies**

Run:

```bash
npm create vite@latest apps/web -- --template vue-ts
npm pkg set name=@remote/web -w apps/web
npm install -w @remote/web @remote/shared pinia vue-router lucide-vue-next
npm install -D -w @remote/web tailwindcss @tailwindcss/vite vitest @vue/test-utils jsdom
```

Expected: Vite Vue TypeScript files exist; remove demo assets and components before committing.

- [ ] **Step 2: Write failing API-client and session-store tests**

Assert `credentials: 'include'`, typed error parsing, generic fallback on invalid error bodies, authenticated route decisions, and session clearing after `401`. Never assert or expose a JWT field because JavaScript cannot read it.

- [ ] **Step 3: Write failing component and view tests**

Assert auth segmented-control behavior, password/private-key field exclusivity, show/hide button labels, disabled stable submit state, field errors, successful fingerprint display, and clearing all secret fields after failure while retaining name/host/port/username.

- [ ] **Step 4: Run tests and confirm failure**

Run: `npm test -w @remote/web`

Expected: FAIL because production components and stores do not exist.

- [ ] **Step 5: Implement the minimal accessible interface**

Use Composition API `<script setup lang="ts">`, semantic labels, `aria-live` status, Lucide `Eye`/`EyeOff` icons with tooltips, an 8px-or-less radius, stable input/button heights, and a responsive single-column form constrained for scanability. Import Tailwind through `@import "tailwindcss"`; configure the Vite Tailwind plugin. Do not persist form or credential values.

The submit handler must copy the current payload for the request, clear component-held secret refs in `finally`, and render only the credential-free `ServerDto` on success.

- [ ] **Step 6: Run web tests and commit**

Run: `npm test -w @remote/web && npm run typecheck -w @remote/web && npm run build -w @remote/web`

Expected: tests PASS and Vite production build succeeds.

Commit:

```bash
git add package-lock.json apps/web
git commit -m "feat: add create server web flow"
```

### Task 9: Docker, End-To-End Coverage, And Delivery Gate

**Files:**
- Create: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/web/nginx.conf`
- Create: `compose.yaml`, `.env.example`, `playwright.config.ts`
- Create: `tests/e2e/fixtures/ssh-server.ts`, `tests/e2e/create-server.spec.ts`
- Modify: root `package.json`
- Create: `README.md`

**Interfaces:**
- Produces: same-origin application at `http://localhost:8080`; `/api/*` proxies to the internal API container.
- The E2E fixture listens only on loopback, generates its host key at runtime, and accepts deterministic test credentials.

- [ ] **Step 1: Install Playwright and write the failing browser flow**

Run: `npm install -D @playwright/test && npx playwright install chromium`

Test login, password SSH success, private-key SSH success, duplicate rejection, bad credential secret clearing, and captured fingerprint visibility. Use role/label locators rather than CSS selectors.

- [ ] **Step 2: Run Playwright and confirm harness failure**

Run: `npm run test:e2e`

Expected: FAIL because the E2E SSH fixture and web servers are not configured.

- [ ] **Step 3: Implement the isolated E2E harness**

Generate an RSA host key and client key with `generateKeyPairSync` at runtime. Start `ssh2.Server` on `127.0.0.1` with an ephemeral port and accept only the test username/password or generated public key. Generate an Argon2id admin hash at harness startup and pass it through the child API environment; do not write it to disk.

- [ ] **Step 4: Add production containers and same-origin proxy**

Use multi-stage Node builds, run the API as a non-root user, copy only production artifacts, and use unprivileged Nginx for the web image. Compose mounts a named SQLite volume and requires runtime secrets through `${VARIABLE:?message}` expressions. `.env.example` contains generation commands and empty variable assignments, never usable secret values.

- [ ] **Step 5: Add root quality commands and operator documentation**

Root scripts must expose `lint`, `typecheck`, `test`, `test:e2e`, `build`, and `dev`. README documents prerequisites, Argon2 hash generation, 32-byte encryption-key generation, JWT-secret generation, local run, Docker run, TOFU risk, and exact Create Server scope.

- [ ] **Step 6: Run the full delivery gate**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
docker compose config
docker compose build
docker compose up -d
docker compose ps
docker compose down
```

Expected: every command exits `0`; Playwright passes on desktop Chromium and a mobile viewport; both containers report healthy; no secrets appear in build output or API responses.

- [ ] **Step 7: Perform browser visual verification**

Open `http://localhost:8080` in the in-app browser. Capture desktop and mobile screenshots for Login, password form, private-key form, loading, error, and success states. Verify no overlap, horizontal overflow, layout shift, clipped text, blank areas, or credential retention.

- [ ] **Step 8: Review scope and commit delivery assets**

Run:

```bash
rg -n "SFTP|RDP|VNC|MFA|Team|Port Forward|localStorage|sessionStorage" apps packages tests
git diff --check
git status --short
```

Expected: prohibited feature terms have no implementation; browser storage is not used for JWTs or credentials; diff check is clean.

Commit:

```bash
git add package.json package-lock.json apps/api/Dockerfile apps/web/Dockerfile apps/web/nginx.conf compose.yaml .env.example playwright.config.ts tests README.md
git commit -m "test: verify create server delivery"
```

---

## Delivery Output

After implementation, report:

1. What changed
2. Why each change was required
3. Files created or modified
4. Remaining risks, including first-use TOFU MITM exposure
5. Test results
6. Build commands
7. Run commands and the verified local URL
