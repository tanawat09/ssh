# Delete Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an audited hard-delete flow for saved servers that refuses deletion while any terminal reservation for the server is active.

**Architecture:** A shared in-process `TerminalSessionManager` provides the active-server guard. `DeleteServerService` owns stable error mapping and delegates successful persistence to one SQLite transaction that deletes the server and inserts its audit event. Fastify exposes an authenticated DELETE endpoint, while Vue presents one accessible confirmation dialog and removes the row only after HTTP 204.

**Tech Stack:** Node.js 22, TypeScript strict mode, Fastify, SQLite/better-sqlite3, Vue 3, Pinia, lucide-vue-next, Vitest, Playwright, Docker Compose

## Global Constraints

- Preserve all create, list, SSH terminal, database, environment, and Docker behavior.
- Use hard delete; do not add soft delete, restore, bulk delete, or retention logic.
- Reject deletion for an active or connecting terminal reservation owned by any actor.
- Never disconnect a terminal automatically.
- Return 204 with no response body after success.
- Never return or audit credentials, host keys, terminal content, session IDs, SQL errors, or raw payloads.
- Do not modify `.worktrees/create-server`; all work applies to the current `main` workspace.
- Follow TDD for each behavioral change and commit each completed task.

---

### Task 1: Active-Session Contract and Delete Permission

**Files:**

- Modify: `packages/shared/src/api-error.ts`
- Modify: `apps/api/src/security/permissions.ts`
- Modify: `apps/api/src/security/permissions.test.ts`
- Modify: `apps/api/src/terminal/terminal-session-manager.ts`
- Modify: `apps/api/src/terminal/terminal-session-manager.test.ts`

**Interfaces:**

- Produces: `ApiErrorCode.SERVER_HAS_ACTIVE_SESSION`
- Produces: permission literal `'servers:delete'`
- Produces: `TerminalSessionManager.isServerActive(serverId: string): boolean`

- [ ] **Step 1: Write failing permission and session-query tests**

Add assertions that admin authorization accepts `servers:delete`, and add these
session-manager cases:

```ts
it('reports a server active across actors until its reservation is released', () => {
  const manager = new TerminalSessionManager()
  const reservation = manager.reserve('operator-a', 'server-1')

  expect(manager.isServerActive('server-1')).toBe(true)
  expect(manager.isServerActive('server-2')).toBe(false)

  reservation.release()
  expect(manager.isServerActive('server-1')).toBe(false)
})

it('keeps a server active while another actor still has a reservation', () => {
  const manager = new TerminalSessionManager()
  const first = manager.reserve('operator-a', 'server-1')
  manager.reserve('operator-b', 'server-1')

  first.release()
  expect(manager.isServerActive('server-1')).toBe(true)
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules:/app/node_modules -w /app node:22-bookworm-slim npm test -w @remote/api -- permissions.test.ts terminal-session-manager.test.ts
```

Expected: FAIL because `servers:delete` and `isServerActive` do not exist.

- [ ] **Step 3: Add the stable error, permission, and read-only query**

Extend the shared constant:

```ts
SERVER_HAS_ACTIVE_SESSION: 'SERVER_HAS_ACTIVE_SESSION',
```

Extend API permission types and the admin set:

```ts
export type Permission =
  'servers:create' | 'servers:read' | 'servers:connect' | 'servers:delete'
```

Add the manager query without exposing its maps:

```ts
isServerActive(serverId: string): boolean {
  for (const sessions of this.#sessionsByActor.values()) {
    if (sessions.has(serverId)) return true
  }
  return false
}
```

- [ ] **Step 4: Run shared and API tests and verify GREEN**

Run:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules:/app/node_modules -w /app node:22-bookworm-slim sh -lc 'npm run build:shared && npm test -w @remote/shared -- terminal-contract.test.ts && npm test -w @remote/api -- permissions.test.ts terminal-session-manager.test.ts'
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/api-error.ts apps/api/src/security/permissions.ts apps/api/src/security/permissions.test.ts apps/api/src/terminal/terminal-session-manager.ts apps/api/src/terminal/terminal-session-manager.test.ts
git commit -m "feat(api): expose delete permission and session guard"
```

---

### Task 2: Atomic Repository Deletion

**Files:**

- Modify: `apps/api/src/database/server-repository.ts`
- Modify: `apps/api/src/database/server-repository.test.ts`

**Interfaces:**

- Consumes: existing `AuditEvent` and `serializeAuditMetadata`
- Produces: `ServerRepository.deleteWithAudit(id: string, event: AuditEvent): boolean`

- [ ] **Step 1: Write repository tests for success, not found, cascade, audit, and rollback**

Create two servers with encrypted credentials, then assert:

```ts
const deleted = repository.deleteWithAudit('server-1', {
  id: 'audit-delete-1',
  action: 'server.delete',
  result: 'success',
  actor: 'admin',
  targetType: 'server',
  targetId: 'server-1',
  metadata: { resource: 'server' },
  createdAt: '2026-07-20T00:00:00.000Z',
})

expect(deleted).toBe(true)
expect(repository.listAll().map(({ id }) => id)).toEqual(['server-2'])
expect(credentialCountFor('server-1')).toBe(0)
expect(readAudit('audit-delete-1')).toMatchObject({
  action: 'server.delete',
  result: 'success',
  target_id: 'server-1',
  metadata: JSON.stringify({ resource: 'server' }),
})
```

Also assert a missing ID returns `false` without a success audit, and force the
audit insert to fail to prove the server deletion rolls back.

- [ ] **Step 2: Run the repository test and verify RED**

Run:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules:/app/node_modules -w /app node:22-bookworm-slim npm test -w @remote/api -- server-repository.test.ts
```

Expected: FAIL because `deleteWithAudit` does not exist.

- [ ] **Step 3: Implement prepared statements and one transaction**

Add these private fields and initialize them in the constructor:

```ts
readonly #deleteServer: Database.Statement
readonly #deleteWithAuditTransaction: (id: string, event: AuditEvent) => boolean

this.#deleteServer = database.prepare('DELETE FROM servers WHERE id = ?')
this.#deleteWithAuditTransaction = database.transaction(
  (id: string, event: AuditEvent): boolean => {
    const result = this.#deleteServer.run(id)
    if (result.changes === 0) return false
    this.#insertSuccessAudit.run(
      event.id,
      event.action,
      event.result,
      event.actor,
      event.targetType,
      event.targetId ?? null,
      event.sourceIp ?? null,
      serializeAuditMetadata(event.metadata),
      event.createdAt,
    )
    return true
  },
)
```

Expose the guarded method:

```ts
deleteWithAudit(id: string, event: AuditEvent): boolean {
  if (event.result !== 'success') {
    throw new Error('ServerRepository.deleteWithAudit requires a success event')
  }
  return this.#deleteWithAuditTransaction(id, event)
}
```

- [ ] **Step 4: Run repository and database tests and verify GREEN**

Run:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules:/app/node_modules -w /app node:22-bookworm-slim npm test -w @remote/api -- server-repository.test.ts database.test.ts audit-repository.test.ts
```

Expected: all selected tests PASS, including rollback and credential cascade.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database/server-repository.ts apps/api/src/database/server-repository.test.ts
git commit -m "feat(api): delete servers and audit atomically"
```

---

### Task 3: Delete Service and Stable Errors

**Files:**

- Create: `apps/api/src/servers/delete-server-service.ts`
- Create: `apps/api/src/servers/delete-server-service.test.ts`

**Interfaces:**

- Consumes: `TerminalSessionManager.isServerActive(serverId: string): boolean`
- Consumes: `ServerRepository.deleteWithAudit(id, event): boolean`
- Consumes: `AuditRepository.recordFailure(event): void`
- Produces: `DeleteServerService.execute(serverId: string, context: DeleteServerContext): void`

- [ ] **Step 1: Write failing service tests**

Cover active, success, not found, repository failure, and failure-audit failure.
The active test must prove persistence is not called:

```ts
expect(() => service.execute('server-1', context)).toThrow(
  expect.objectContaining({
    code: ApiErrorCode.SERVER_HAS_ACTIVE_SESSION,
    statusCode: 409,
  }),
)
expect(deleteWithAudit).not.toHaveBeenCalled()
expect(recordFailure).toHaveBeenCalledWith(
  expect.objectContaining({
    action: 'server.delete',
    targetId: 'server-1',
    metadata: {
      resource: 'server',
      errorCode: ApiErrorCode.SERVER_HAS_ACTIVE_SESSION,
    },
  }),
)
```

Success must call `deleteWithAudit` with a `server.delete` success event and not
call `recordFailure`. A `false` result maps to `SERVER_NOT_FOUND`; a thrown
repository error maps to `INTERNAL_ERROR`.

- [ ] **Step 2: Run the service test and verify RED**

Run:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules:/app/node_modules -w /app node:22-bookworm-slim npm test -w @remote/api -- delete-server-service.test.ts
```

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement the synchronous service**

Use these dependency and context boundaries:

```ts
export interface DeleteServerContext {
  actor: string
  sourceIp?: string
}

export interface DeleteServerServiceDependencies {
  serverRepository: Pick<ServerRepository, 'deleteWithAudit'>
  auditRepository: Pick<AuditRepository, 'recordFailure'>
  sessionManager: Pick<TerminalSessionManager, 'isServerActive'>
  generateId?: () => string
  now?: () => Date
}
```

Implement `execute` without `await`. Build one sanitized source object, throw
409 before repository access when active, call `deleteWithAudit`, convert false
to 404, and map unknown errors to 500. In the catch block, record this event in
a nested try/catch before rethrowing the stable `ApplicationError`:

```ts
{
  id: generateId(),
  action: 'server.delete',
  result: 'failure',
  actor: context.actor,
  targetType: 'server',
  targetId: serverId,
  ...source,
  metadata: { resource: 'server', errorCode: applicationError.code },
  createdAt: now().toISOString(),
}
```

- [ ] **Step 4: Run service and audit tests and verify GREEN**

Run:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules:/app/node_modules -w /app node:22-bookworm-slim npm test -w @remote/api -- delete-server-service.test.ts audit-repository.test.ts
```

Expected: all selected tests PASS and audit metadata contains only allowlisted
values.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/servers/delete-server-service.ts apps/api/src/servers/delete-server-service.test.ts
git commit -m "feat(api): reject unsafe server deletion"
```

---

### Task 4: DELETE Route and Dependency Wiring

**Files:**

- Modify: `apps/api/src/servers/server-route.ts`
- Modify: `apps/api/src/servers/server-route.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**

- Consumes: `DeleteServerService.execute(serverId, context): void`
- Produces: `DELETE /api/v1/servers/:serverId` returning 204
- Produces: optional `deleteServerService?: DeleteServerExecutor` in app wiring

- [ ] **Step 1: Write failing route tests**

Extend route setup with a delete mock, then cover 204, bounded params,
permission, and propagated 404/409 errors:

```ts
const response = await app.inject({
  method: 'DELETE',
  url: '/api/v1/servers/server-1',
  headers: { origin, cookie: `remote_session=${token}` },
})

expect(response.statusCode).toBe(204)
expect(response.body).toBe('')
expect(deleteServerService.execute).toHaveBeenCalledWith('server-1', {
  actor: 'admin',
  sourceIp: '127.0.0.1',
})
```

Use `ApplicationError` mocks to assert exact 404 and 409 envelopes. Verify a
missing JWT is 401, wrong Origin is 403, and a server ID longer than 128
characters is 400.

- [ ] **Step 2: Run route/app tests and verify RED**

Run:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules:/app/node_modules -w /app node:22-bookworm-slim npm test -w @remote/api -- server-route.test.ts app.test.ts
```

Expected: FAIL because the delete executor and route are not registered.

- [ ] **Step 3: Add the route**

Define the executor:

```ts
export interface DeleteServerExecutor {
  execute(serverId: string, context: { actor: string; sourceIp?: string }): void
}
```

Extend `registerServerRoute` with an optional fourth argument and register:

```ts
app.delete<{ Params: { serverId: string } }>(
  '/api/v1/servers/:serverId',
  {
    preHandler: requirePermission('servers:delete'),
    schema: {
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['serverId'],
        properties: {
          serverId: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
      response: {
        204: { type: 'null' },
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  },
  (request, reply) => {
    deleteServerService.execute(request.params.serverId, {
      actor: 'admin',
      sourceIp: request.ip,
    })
    return reply.status(204).send()
  },
)
```

- [ ] **Step 4: Share one session manager and wire dependencies**

Add `deleteServerService` to `BuildAppOptions` and route registration. In
`server.ts`, create exactly one manager:

```ts
const terminalSessionManager = new TerminalSessionManager()
const deleteServerService = new DeleteServerService({
  serverRepository,
  auditRepository,
  sessionManager: terminalSessionManager,
})
```

Pass the same instance to `deleteServerService` and
`terminalRouteDependencies.sessionManager`.

- [ ] **Step 5: Run API tests, typecheck, and verify GREEN**

Run:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules:/app/node_modules -w /app node:22-bookworm-slim sh -lc 'npm test -w @remote/api -- server-route.test.ts app.test.ts delete-server-service.test.ts && npm run typecheck -w @remote/api'
```

Expected: all selected tests and API strict typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/servers/server-route.ts apps/api/src/servers/server-route.test.ts apps/api/src/app.ts apps/api/src/app.test.ts apps/api/src/server.ts
git commit -m "feat(api): expose authenticated server deletion"
```

---

### Task 5: Frontend API and Confirmation Dialog

**Files:**

- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/lib/api-client.test.ts`
- Modify: `apps/web/src/views/ServerListView.vue`
- Modify: `apps/web/src/views/ServerListView.test.ts`
- Modify: `apps/web/src/style.css`

**Interfaces:**

- Produces: `ApiClient.deleteServer(serverId: string): Promise<void>`
- Produces: optional `deleteServer?: (serverId: string) => Promise<void>` view prop for isolated tests

- [ ] **Step 1: Write failing API client tests**

Assert encoded IDs, credentialed DELETE, and 204 without JSON parsing:

```ts
const fetcher = vi
  .fn<typeof fetch>()
  .mockResolvedValue(new Response(null, { status: 204 }))

await expect(
  new ApiClient(fetcher).deleteServer('server/id'),
).resolves.toBeUndefined()
expect(fetcher).toHaveBeenCalledWith('/api/v1/servers/server%2Fid', {
  method: 'DELETE',
  credentials: 'include',
})
```

Add a 409 response test that expects `ApiClientError` with
`SERVER_HAS_ACTIVE_SESSION`.

- [ ] **Step 2: Run API client tests and verify RED**

Run:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules:/app/node_modules -w /app node:22-bookworm-slim npm test -w @remote/web -- api-client.test.ts
```

Expected: FAIL because `deleteServer` does not exist.

- [ ] **Step 3: Generalize the no-body request path and implement DELETE**

Add a private response parser that only calls `response.json()` when status is
not 204. Implement:

```ts
deleteServer(serverId: string): Promise<void> {
  return this.delete(`/api/v1/servers/${encodeURIComponent(serverId)}`)
}

private async delete(path: string): Promise<void> {
  const response = await this.fetcher(path, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (response.ok) return
  const value = await this.readJson(response)
  this.throwResponseError(response.status, value)
}
```

Keep existing login/create/list request shapes unchanged and avoid duplicate
error-envelope logic by reusing typed private helpers.

- [ ] **Step 4: Write failing view tests**

Extend `mountView` to inject `deleteServer`. Test:

- Delete icon has `aria-label="Delete Production"` and a title.
- Clicking opens one dialog containing `Production` and
  `deploy@server.example.com:22`.
- Cancel makes no request.
- Confirm disables destructive actions while pending.
- Success removes only `server-id`.
- 409 shows `Disconnect the active terminal before deleting this server.` and
  keeps the row.
- 401 redirects to `{ name: 'login' }` and keeps the row.

Use a deferred promise for pending state and an injected mock for all requests.

- [ ] **Step 5: Run view tests and verify RED**

Run:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules:/app/node_modules -w /app node:22-bookworm-slim npm test -w @remote/web -- ServerListView.test.ts
```

Expected: FAIL because the dialog and injected delete operation do not exist.

- [ ] **Step 6: Implement the confirmation workflow**

Add `Trash2` and `X` lucide icons, reactive `selectedServer`, `deletePending`, and
`deleteError`. Render a single page-level overlay only when a server is
selected:

```vue
<div v-if="selectedServer" class="dialog-backdrop" @click.self="closeDeleteDialog">
  <section
    class="confirmation-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="delete-server-title"
  >
    <button
      class="icon-button dialog-close"
      type="button"
      title="Cancel deletion"
      aria-label="Cancel deletion"
      :disabled="deletePending"
      @click="closeDeleteDialog"
    >
      <X :size="18" aria-hidden="true" />
    </button>
    <h2 id="delete-server-title">Delete {{ selectedServer.name }}?</h2>
    <p>{{ selectedServer.username }}@{{ selectedServer.host }}:{{ selectedServer.port }}</p>
    <p v-if="deleteError" class="form-error">{{ deleteError }}</p>
    <div class="dialog-actions">
      <button class="secondary-button" type="button" :disabled="deletePending" @click="closeDeleteDialog">Cancel</button>
      <button class="danger-button" type="button" :disabled="deletePending" @click="confirmDelete">Delete server</button>
    </div>
  </section>
</div>
```

`confirmDelete` must call `session.runAuthenticated`, remove the row only after
success, map the 409 code to the approved instruction, and redirect only for 401. Add restrained responsive CSS with stable icon-button dimensions and no
nested cards.

- [ ] **Step 7: Run frontend tests, typecheck, and verify GREEN**

Run:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules:/app/node_modules -w /app node:22-bookworm-slim sh -lc 'npm test -w @remote/web -- api-client.test.ts ServerListView.test.ts && npm run typecheck -w @remote/web'
```

Expected: API client and Server List tests PASS with strict TypeScript.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/lib/api-client.test.ts apps/web/src/views/ServerListView.vue apps/web/src/views/ServerListView.test.ts apps/web/src/style.css
git commit -m "feat(web): confirm and delete saved servers"
```

---

### Task 6: End-to-End and Deployment Verification

**Files:**

- Create: `tests/e2e/delete-server.spec.ts`
- Modify only if required by the test: `tests/e2e/fixtures/ssh-server.ts`

**Interfaces:**

- Consumes: create/list/delete REST flows and terminal WebSocket flow
- Produces: automated proof that active sessions block deletion and disconnected servers can be deleted

- [ ] **Step 1: Write the failing Playwright flow**

Create a unique saved server, open its terminal, and attempt deletion from the
Server List:

```ts
await serverRow.getByRole('button', { name: 'Delete Delete target' }).click()
await page.getByRole('button', { name: 'Delete server' }).click()
await expect(
  page.getByText('Disconnect the active terminal before deleting this server.'),
).toBeVisible()
await expect(serverRow).toBeVisible()
```

Return to terminals, disconnect that tab, return to servers, confirm deletion,
and assert the row is absent after 204. The test must not inspect credentials,
cookies, or database files.

- [ ] **Step 2: Run Playwright and verify RED**

Run:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules-pw:/app/node_modules -w /app mcr.microsoft.com/playwright:v1.61.1-noble sh -lc 'npm run build && npx playwright test tests/e2e/delete-server.spec.ts --project desktop-chromium --reporter=line'
```

Expected: FAIL before the delete UI/API implementation is present.

- [ ] **Step 3: Make only fixture adjustments proven necessary by RED**

If the SSH fixture needs a new accepted username, add exactly that username to
the existing `terminalUsernames` set. Do not change SSH authentication or shell
behavior otherwise.

- [ ] **Step 4: Run focused and complete E2E suites and verify GREEN**

Run focused:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules-pw:/app/node_modules -w /app mcr.microsoft.com/playwright:v1.61.1-noble sh -lc 'npm run build && npx playwright test tests/e2e/delete-server.spec.ts --project desktop-chromium --reporter=line'
```

Then run all projects:

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules-pw:/app/node_modules -w /app mcr.microsoft.com/playwright:v1.61.1-noble npm run test:e2e
```

Expected: focused delete flow and all desktop/mobile E2E tests PASS.

- [ ] **Step 5: Run all repository quality gates**

```bash
docker run --rm -v "$PWD":/app -v remote-platform-node-modules:/app/node_modules -w /app node:22-bookworm-slim sh -lc 'npm run format:check && npm run lint && npm run typecheck && npm test && npm run build'
```

Expected: Prettier, ESLint, strict typecheck, all Vitest suites, and production
build PASS with exit code 0.

- [ ] **Step 6: Rebuild and smoke-test Docker Compose**

Keep the ignored `.env` and its current port configuration. Run:

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl -fsS http://localhost:8081/health
```

Expected: Compose config is valid, `api` and `web` are healthy, and health
returns `healthy`. Repeat the authenticated login and WebSocket smoke used by
the previous terminal delivery, then create and delete a disposable server
through the public API without printing secrets.

- [ ] **Step 7: Commit E2E coverage**

```bash
git add tests/e2e/delete-server.spec.ts tests/e2e/fixtures/ssh-server.ts
git commit -m "test: verify guarded server deletion"
```

- [ ] **Step 8: Review and publish**

```bash
git diff origin/main...HEAD --check
git status --short --branch
git push origin main
```

Expected: no whitespace errors, clean `main`, and GitHub `origin/main` advances
to the verified commit. Leave the healthy Docker Compose services running.
