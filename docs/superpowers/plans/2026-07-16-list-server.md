# List Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated `List Server` workflow that returns public server DTOs and records one `server.list` audit event for every request.

**Architecture:** Extend the existing repository and Fastify route layers with a read-only query that selects only public server columns. Keep audit writing in the API service boundary so both success and failure paths are recorded. Add a dedicated authenticated Vue view and API client method without changing `ServerDto` or secret handling.

**Tech Stack:** Node.js, TypeScript strict mode, Fastify, SQLite/better-sqlite3, Vue 3, Pinia, Vue Router, Vitest, Playwright.

## Global Constraints

- Do not return or persist passwords, private keys, encrypted credential payloads, or host-key bytes in list responses or audit metadata.
- Require the existing `servers:read` permission and preserve JWT HttpOnly-cookie authentication.
- Keep the endpoint additive and preserve the existing `ServerDto` contract.
- Record one `server.list` audit event for every authenticated list execution,
  including service/repository failures; unauthenticated and forbidden requests
  remain handled by the existing permission layer.
- Do not add pagination, search, delete, terminal, SFTP, or client-side secret storage.
- Use TDD: each production change follows a failing test and a passing verification.

---

### Task 1: Shared API client contract and repository query

**Files:**

- Modify: `apps/api/src/database/server-repository.ts`
- Test: `apps/api/src/database/server-repository.test.ts`
- Modify: `apps/web/src/lib/api-client.ts`
- Test: `apps/web/src/lib/api-client.test.ts`

**Interfaces:**

- Produces `ServerRepository.listAll(): ServerDto[]`, ordered by `created_at ASC, id ASC`, selecting only public columns.
- Produces `ApiClient.listServers(): Promise<ServerDto[]>` using `GET /api/v1/servers` and credentials included.

- [ ] **Step 1: Write failing repository tests**

Add tests that insert two public server rows plus credential rows, call `listAll()`, assert creation order and exact public DTO fields, and assert no credential or host-key-byte field is present.

- [ ] **Step 2: Run repository tests and verify failure**

Run `npm test -w @remote/api -- server-repository.test.ts` in the Node 22 test container. Expected: TypeScript/test failure because `listAll` is not defined.

- [ ] **Step 3: Implement the minimal public query**

Prepare a statement selecting `id, name, host, port, username, auth_type, host_key_algorithm, host_key_fingerprint, created_at, updated_at` from `servers ORDER BY created_at ASC, id ASC`, then map database column names to `ServerDto`.

- [ ] **Step 4: Verify repository tests pass**

Run the same command. Expected: all repository tests pass.

- [ ] **Step 5: Write failing API client tests**

Add a test whose fetcher returns a JSON array and assert `listServers()` calls `GET /api/v1/servers` with `credentials: 'include'` and no request body.

- [ ] **Step 6: Implement and verify the API client method**

Extend the client with `listServers(): Promise<ServerDto[]>` and run `npm test -w @remote/web -- api-client.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/database/server-repository.ts apps/api/src/database/server-repository.test.ts apps/web/src/lib/api-client.ts apps/web/src/lib/api-client.test.ts
git commit -m "feat: add public server listing query"
```

### Task 2: Audit service and protected list route

**Files:**

- Modify: `apps/api/src/database/audit-repository.ts`
- Test: `apps/api/src/database/audit-repository.test.ts`
- Create: `apps/api/src/servers/list-server-service.ts`
- Test: `apps/api/src/servers/list-server-service.test.ts`
- Modify: `apps/api/src/servers/server-route.ts`
- Test: `apps/api/src/servers/server-route.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**

- Produces `ListServerService.execute(context: { actor: string; sourceIp?: string }): Promise<ServerDto[]>`.
- Consumes `ServerRepository.listAll()` and an audit writer for success/failure events.
- Produces `GET /api/v1/servers` with response `ServerDto[]`, protected by `requirePermission('servers:read')`.

- [ ] **Step 1: Write failing audit and service tests**

Cover success metadata `{ resource: 'server', count }`, source IP, actor, and `server.list` action. Cover repository failure creating a failure audit with bounded metadata and rethrowing a generic application error.

- [ ] **Step 2: Run focused tests and verify failure**

Run `npm test -w @remote/api -- audit-repository.test.ts list-server-service.test.ts server-route.test.ts`. Expected: missing service/route behavior failures.

- [ ] **Step 3: Implement list service and audit helper**

Extend audit metadata sanitization with a bounded numeric `count` field. Write the service with a single try/catch: call `listAll`, write one success audit with count, or write one failure audit with only `{ resource: 'server' }` and convert unknown errors to the existing generic internal error.

- [ ] **Step 4: Register the protected GET route**

Register `GET /api/v1/servers` with `servers:read`, `ServerDtoSchema` array response, existing API error schemas, and `{ actor: 'admin', sourceIp: request.ip }` context.

- [ ] **Step 5: Wire the service in `app.ts`**

Instantiate the service from the existing repository/database/audit dependencies without changing the create route wiring.

- [ ] **Step 6: Verify focused API tests pass**

Run the focused command again. Expected: all list, route, audit, and existing server tests pass, including 401/403 permission checks.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/database/audit-repository.ts apps/api/src/database/audit-repository.test.ts apps/api/src/servers/list-server-service.ts apps/api/src/servers/list-server-service.test.ts apps/api/src/servers/server-route.ts apps/api/src/servers/server-route.test.ts apps/api/src/app.ts
git commit -m "feat: add audited list servers endpoint"
```

### Task 3: Authenticated Vue server list view and navigation

**Files:**

- Create: `apps/web/src/views/ServerListView.vue`
- Test: `apps/web/src/views/ServerListView.test.ts`
- Modify: `apps/web/src/router.ts`
- Modify: `apps/web/src/views/CreateServerView.vue`

**Interfaces:**

- Consumes `apiClient.listServers()` through `session.runAuthenticated`.
- Produces authenticated route `/servers` and navigation to `/servers/new`.

- [ ] **Step 1: Write failing view tests**

Cover loading state, empty state, populated public fields, API error state, and redirect to `login` on `401`. Assert no credential-like fields are rendered.

- [ ] **Step 2: Run view tests and verify failure**

Run `npm test -w @remote/web -- ServerListView.test.ts`. Expected: module/view/route behavior failures.

- [ ] **Step 3: Implement the view**

Create a focused list view with `pending`, `servers`, and `errorMessage` state. Render stable rows/cards using existing CSS conventions, include a Create Server link, and clear transient state on reload.

- [ ] **Step 4: Add router and navigation changes**

Make `/` redirect to `/servers`, register the authenticated route, and add a link from Create Server back to the list.

- [ ] **Step 5: Verify view tests pass**

Run the focused view command and then `npm test -w @remote/web`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/ServerListView.vue apps/web/src/views/ServerListView.test.ts apps/web/src/router.ts apps/web/src/views/CreateServerView.vue
git commit -m "feat: add server list view"
```

### Task 4: Full verification and delivery gate

**Files:**

- Modify: `tests/e2e/create-server.spec.ts` only if the authenticated landing route changes require setup updates.
- Modify: `tests/e2e/create-server.mobile.spec.ts` only if selectors or navigation require updates.

- [ ] **Step 1: Add one real E2E list assertion**

After login, assert `/servers` loads, then create a server through the existing flow and assert the new server appears in the list after navigation or reload without exposing credentials.

- [ ] **Step 2: Run the E2E regression**

Run `npm run test:e2e` in the Playwright container. Expected: desktop and mobile tests pass.

- [ ] **Step 3: Run repository quality gates**

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` in the Node 22 container. Expected: zero failures.

- [ ] **Step 4: Run deployment checks**

Run `docker compose config --quiet`, build the API/web images, start the stack with explicit `ALLOWED_ORIGIN`, verify both health checks and that only web publishes port `8080`, then run `docker compose down` while preserving the SQLite volume.

- [ ] **Step 5: Review the diff and commit the verification report**

Run `git diff --check`, inspect changed files for secret leakage and scope expansion, record results in `.superpowers/sdd/list-server-report.md` (ignored), and commit any required test-only changes.
