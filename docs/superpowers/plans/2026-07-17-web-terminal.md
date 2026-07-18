# Web Terminal Multi-Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an authenticated, audited SSH Web Terminal with up to five simultaneous terminal tabs connected to different saved servers.

**Architecture:** One Fastify WebSocket owns one in-memory reservation, one ssh2 client, and one PTY channel. The Vue terminal store owns one WebSocket per tab; xterm.js panes stay mounted while inactive so terminal buffers and connections survive tab switches.

**Tech Stack:** TypeScript strict mode, Fastify 5, `@fastify/websocket`, `ws`, `ssh2`, SQLite, Vue 3, Pinia, `@xterm/xterm`, `@xterm/addon-fit`, Vitest, Playwright, Nginx, Docker Compose.

## Global Constraints

- Keep all existing REST routes, DTOs, database schema, environment variables, login, JWT cookie, and create/list behavior backward compatible.
- Never expose credentials, stored host keys, terminal input, or terminal output through public DTOs, URLs, logs, errors, or audit metadata.
- Enforce exact Origin, authenticated `servers:connect` permission, a maximum of five sessions per actor, and one active session per server.
- Close SSH immediately when the WebSocket closes; do not implement reconnection, resume, recording, SFTP, RDP, VNC, MFA, teams, jump hosts, or port forwarding.
- Write a failing test and observe the expected failure before each production behavior change.

---

### Task 1: Shared Terminal Protocol

**Files:**

- Create: `packages/shared/src/terminal-contract.ts`
- Create: `packages/shared/src/terminal-contract.test.ts`
- Modify: `packages/shared/src/api-error.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Produces: `parseTerminalClientMessage(value: string): TerminalClientMessage | undefined`
- Produces: `serializeTerminalServerMessage(message: TerminalServerMessage): string`
- Produces: stable terminal error codes in `ApiErrorCode`

- [ ] **Step 1: Write strict parser tests**

Cover valid input/resize/disconnect, malformed JSON, extra properties, non-integer resize values, bounds, unknown message types, and input above 16 KiB.

- [ ] **Step 2: Run the shared test and verify RED**

Run: `npm test -w @remote/shared -- terminal-contract.test.ts`

Expected: FAIL because `terminal-contract.js` does not exist.

- [ ] **Step 3: Implement the minimal protocol**

Use TypeBox schemas with `additionalProperties: false`, a compiled value checker, exact constants `TERMINAL_INPUT_MAX_BYTES = 16_384`, columns `20..400`, and rows `5..200`. Parse only strings and return `undefined` instead of throwing for untrusted input.

- [ ] **Step 4: Run shared tests and verify GREEN**

Run: `npm test -w @remote/shared`

Expected: all shared tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): define terminal websocket protocol"
```

### Task 2: Connection Material, Permission, and Audit Allowlist

**Files:**

- Modify: `apps/api/src/database/server-repository.ts`
- Modify: `apps/api/src/database/server-repository.test.ts`
- Modify: `apps/api/src/database/audit-repository.ts`
- Modify: `apps/api/src/database/audit-repository.test.ts`
- Modify: `apps/api/src/security/permissions.ts`
- Modify: `apps/api/src/security/permissions.test.ts`

**Interfaces:**

- Produces: `ServerConnectionMaterial` containing endpoint, auth type, stored host key, and `EncryptedCredential`
- Produces: `ServerRepository.getConnectionMaterialById(id: string): ServerConnectionMaterial | undefined`
- Produces: permission literal `servers:connect`

- [ ] **Step 1: Write repository, audit, and permission tests**

Assert exact Base64 restoration from SQLite BLOBs, undefined for unknown IDs, unchanged public DTO redaction, allowance of `reason` and bounded `durationMs`, rejection of secret metadata, and admin access to `servers:connect`.

- [ ] **Step 2: Run focused API tests and verify RED**

Run: `npm test -w @remote/api -- server-repository.test.ts audit-repository.test.ts permissions.test.ts`

Expected: FAIL for the missing lookup, allowlist keys, and permission.

- [ ] **Step 3: Implement minimal additions**

Add one prepared joined query, map SQLite BLOBs back to Base64, extend only the audit allowlist, and add the permission to the admin role.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2; expected all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database apps/api/src/security
git commit -m "feat(api): expose protected terminal connection material"
```

### Task 3: Terminal Session Manager

**Files:**

- Create: `apps/api/src/terminal/terminal-session-manager.ts`
- Create: `apps/api/src/terminal/terminal-session-manager.test.ts`

**Interfaces:**

- Produces: `reserve(actor: string, serverId: string): TerminalReservation`
- Produces: `TerminalReservation` with `id`, `actor`, `serverId`, and idempotent `release()`
- Throws: `ApplicationError` with duplicate or limit error codes

- [ ] **Step 1: Write manager tests**

Test five distinct reservations, rejection of the sixth, rejection of a duplicate server, reuse after release, actor isolation, and idempotent release.

- [ ] **Step 2: Run test and verify RED**

Run: `npm test -w @remote/api -- terminal-session-manager.test.ts`

Expected: FAIL because the manager module is missing.

- [ ] **Step 3: Implement the in-memory manager**

Use private Maps/Sets and `randomUUID()`. Reserve synchronously before network I/O and remove empty actor collections during release.

- [ ] **Step 4: Run test and verify GREEN**

Run the command from Step 2; expected all manager tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/terminal/terminal-session-manager*
git commit -m "feat(api): enforce terminal session limits"
```

### Task 4: SSH PTY Gateway

**Files:**

- Create: `apps/api/src/terminal/ssh-terminal-gateway.ts`
- Create: `apps/api/src/terminal/ssh-terminal-gateway.test.ts`

**Interfaces:**

- Consumes: `ServerConnectionMaterial` and decrypted `ServerCredential`
- Produces: `openTerminal(options): Promise<SshTerminal>`
- Produces: `SshTerminal` with `write`, `resize`, `pause`, `resume`, `close`, `onData`, and `onClose`

- [ ] **Step 1: Write fake-client gateway tests**

Cover password/private-key config, exact host-key match, mismatch rejection, auth/network/timeout mapping, `xterm-256color` PTY creation, input, resize argument order, data events, and idempotent close.

- [ ] **Step 2: Run test and verify RED**

Run: `npm test -w @remote/api -- ssh-terminal-gateway.test.ts`

Expected: FAIL because the gateway module is missing.

- [ ] **Step 3: Implement the gateway**

Use `timingSafeEqual` after equal-length checks, existing SSH error codes, stored host-key comparison, and a timeout cleared on every settle path. Never include ssh2 error text or connection material in an `ApplicationError`.

- [ ] **Step 4: Run test and verify GREEN**

Run the command from Step 2; expected all gateway tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/terminal/ssh-terminal-gateway*
git commit -m "feat(api): open verified interactive ssh terminals"
```

### Task 5: Authenticated WebSocket Route

**Files:**

- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Create: `apps/api/src/terminal/terminal-route.ts`
- Create: `apps/api/src/terminal/terminal-route.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**

- Consumes: repository, cipher, gateway, manager, audit repository, timeout, allowed origin
- Produces: authenticated `GET /api/v1/servers/:serverId/terminal` WebSocket route

- [ ] **Step 1: Install WebSocket dependencies**

Run: `npm install -w @remote/api @fastify/websocket ws && npm install -D -w @remote/api @types/ws`

- [ ] **Step 2: Write route integration tests**

Use `injectWS` to cover missing/invalid JWT, wrong/missing Origin, permission, missing server, duplicate/limit errors, ready/output/input/resize/disconnect, invalid messages, setup failure, cleanup, backpressure, and sanitized audit events.

- [ ] **Step 3: Run the route test and verify RED**

Run: `npm test -w @remote/api -- terminal-route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 4: Implement route and composition**

Register `@fastify/websocket` before routes with `maxPayload: 65_536` and `perMessageDeflate: false`. Attach socket handlers synchronously, reserve before asynchronous setup, send binary output, enforce bounded flow control, and make cleanup idempotent. Wire real dependencies in `server.ts` and close all active sessions in Fastify shutdown.

- [ ] **Step 5: Run all API tests and verify GREEN**

Run: `npm test -w @remote/api`

Expected: all API tests pass without credential-bearing logs.

- [ ] **Step 6: Commit**

```bash
git add apps/api package.json package-lock.json
git commit -m "feat(api): stream terminal sessions over websocket"
```

### Task 6: Frontend Terminal Session Store

**Files:**

- Create: `apps/web/src/lib/terminal-socket.ts`
- Create: `apps/web/src/lib/terminal-socket.test.ts`
- Create: `apps/web/src/stores/terminal-sessions.ts`
- Create: `apps/web/src/stores/terminal-sessions.test.ts`

**Interfaces:**

- Produces: same-origin `createTerminalSocket(serverId, handlers)`
- Produces: Pinia actions `connect`, `activate`, `disconnect`, and `disconnectAll`
- Produces: maximum five tabs and one tab per server in client state

- [ ] **Step 1: Write socket and store tests**

Test WSS URL derivation/ID encoding, binary output, strict control messages, pending/ready/error/closed states, five-tab cap, duplicate activation, active-tab fallback, and disconnect-all cleanup.

- [ ] **Step 2: Run focused web tests and verify RED**

Run: `npm test -w @remote/web -- terminal-socket.test.ts terminal-sessions.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement socket adapter and store**

Keep browser WebSocket details outside Pinia, set `binaryType = 'arraybuffer'`, never reconnect automatically, and close all connections during store disposal/page teardown.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2; expected all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/terminal-* apps/web/src/stores/terminal-*
git commit -m "feat(web): manage multiple terminal sockets"
```

### Task 7: xterm Terminal Tabs Workspace

**Files:**

- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Create: `apps/web/src/components/TerminalPane.vue`
- Create: `apps/web/src/components/TerminalPane.test.ts`
- Create: `apps/web/src/views/TerminalWorkspaceView.vue`
- Create: `apps/web/src/views/TerminalWorkspaceView.test.ts`
- Modify: `apps/web/src/views/ServerListView.vue`
- Modify: `apps/web/src/views/ServerListView.test.ts`
- Modify: `apps/web/src/router.ts`
- Modify: `apps/web/src/style.css`

**Interfaces:**

- Consumes: terminal store, `ServerDto[]`, xterm input/output, FitAddon dimensions
- Produces: authenticated `/terminals` route and Connect actions from server list

- [ ] **Step 1: Install xterm dependencies**

Run: `npm install -w @remote/web @xterm/xterm @xterm/addon-fit`

- [ ] **Step 2: Write component/view tests**

Stub xterm and ResizeObserver. Test input forwarding, binary writes, debounced resize, disposal, loading/list errors, sidebar connect state, tab switching, close icons/tooltips, session counter, and mobile sidebar toggle.

- [ ] **Step 3: Run focused web tests and verify RED**

Run: `npm test -w @remote/web -- TerminalPane.test.ts TerminalWorkspaceView.test.ts ServerListView.test.ts`

Expected: FAIL for missing components and Connect behavior.

- [ ] **Step 4: Implement the approved Terminal Tabs UI**

Use `v-show` for mounted inactive panes, lucide icons for connect/close/menu, fixed terminal workspace dimensions, horizontal tab overflow, accessible labels/tooltips, and responsive sidebar behavior. Import xterm CSS once.

- [ ] **Step 5: Run all web tests and verify GREEN**

Run: `npm test -w @remote/web`

Expected: all web tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web package-lock.json
git commit -m "feat(web): add multi-tab ssh terminal workspace"
```

### Task 8: Proxy and End-to-End Terminal Flow

**Files:**

- Modify: `apps/web/nginx.conf`
- Modify: `tests/e2e/fixtures/ssh-server.ts`
- Create: `tests/e2e/web-terminal.spec.ts`
- Create: `tests/e2e/web-terminal.mobile.spec.ts`

**Interfaces:**

- Produces: WebSocket-capable Nginx `/api/` proxy
- Produces: local PTY/shell fixture supporting deterministic commands and resize

- [ ] **Step 1: Extend the SSH fixture and write Playwright tests**

Test login, creation of two distinct saved servers, two live terminal tabs,
command output, tab switching, explicit disconnect, and the responsive mobile
workspace. Add a WebSocket-aware local reverse proxy for Playwright.

- [ ] **Step 2: Run Playwright and verify RED**

Run: `npm run test:e2e -- --grep "web terminal"`

Expected: FAIL before the fixture proxy and shell support are implemented.

- [ ] **Step 3: Implement proxy/fixture support**

Add Nginx upgrade headers with a connection map and `proxy_read_timeout 1h`.
Make the test SSH server accept PTY, window-change, and shell requests and echo a
deterministic prompt/command response.

- [ ] **Step 4: Run Playwright and verify GREEN**

Run: `npm run test:e2e`

Expected: desktop and mobile projects pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/nginx.conf tests/e2e
git commit -m "test: verify interactive web terminal flows"
```

### Task 9: Full Quality and Deployment Verification

**Files:**

- Modify only files required to correct defects revealed by verification.

**Interfaces:**

- Produces: a reproducible production build and healthy Docker Compose deployment.

- [ ] **Step 1: Run repository quality gates**

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: every command exits zero with no test failures.

- [ ] **Step 2: Verify Docker Compose**

Build and start with valid `.env` secrets, wait for both services to become
healthy, verify `/health`, login, server list, and a WebSocket upgrade through
the web service, then shut the stack down without deleting the named data
volume.

- [ ] **Step 3: Review security and compatibility**

Run `git diff --check`, inspect changed files, search for secret-bearing logs and
URLs, and confirm no schema migration or unrelated feature was added.

- [ ] **Step 4: Commit any verification-only corrections**

```bash
git add apps/api apps/web packages/shared tests package.json package-lock.json
git commit -m "fix: satisfy web terminal quality gates"
```

- [ ] **Step 5: Push the verified main branch**

Run: `git push origin main`

Expected: `origin/main` advances to the verified local commit.
