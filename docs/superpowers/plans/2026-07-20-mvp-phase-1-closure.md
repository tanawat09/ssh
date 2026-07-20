# MVP Phase 1 Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualify the completed Web Remote Platform MVP Phase 1, publish accurate
operator documentation, align release metadata to `0.1.0`, and publish the
immutable annotated tag `v0.1.0` only after every release gate passes.

**Architecture:** Keep runtime code and public contracts unchanged. First align
package metadata, then replace the stale README scope and qualify the candidate
through locked Node.js, Playwright, and isolated Compose gates. After review,
fast-forward the documentation branch to `main`, verify the production Compose
deployment, record sanitized evidence, rerun gates on the final commit, and push
`main` plus the annotated tag.

**Tech Stack:** Markdown, npm workspaces, Node.js 22, TypeScript, Vitest,
Playwright 1.61.1, Docker Compose, Git

## Global Constraints

- Do not add or change runtime application behavior unless a release gate proves
  a defect and the user separately approves its TDD fix.
- Align the API workspace's internal `@remote/shared` dependency range to
  `^0.1.0`; do not change any external dependency name or version.
- Keep REST routes under `/api/v1`; `v0.1.0` is release metadata, not an API
  version change.
- Do not create SFTP, RDP, VNC, MFA, team, port-forwarding, jump-host,
  recording, backup, load-test, or secret-rotation behavior.
- Never print, copy, commit, or audit passwords, JWTs, cookies, private keys,
  passphrases, encryption keys, encrypted credentials, terminal contents, or
  `.env` values.
- Keep the existing `.env`, SQLite data, Docker production volumes, published
  port, authentication, permissions, Origin validation, and TLS validation.
- Use `SMOKE_ADMIN_PASSWORD` only as an interactive exported shell variable;
  never place its value in a command, file, report, or Git history.
- A failed release gate blocks merge, push, and tag creation.
- Never move, replace, delete, or force-push an existing `v0.1.0` tag.
- Keep `.worktrees/create-server` and all unrelated user changes untouched.
- Use ASCII in repository files and strict existing Prettier formatting.

---

## File Map

- `package.json`: root release version.
- `apps/api/package.json`: API workspace release version.
- `apps/web/package.json`: web workspace release version.
- `packages/shared/package.json`: shared-contract workspace release version.
- `package-lock.json`: mechanically synchronized root and workspace versions.
- `README.md`: durable Phase 1 operator and developer guidance.
- `docs/releases/v0.1.0-checklist.md`: sanitized evidence for this release.
- `docs/superpowers/specs/2026-07-20-mvp-phase-1-closure-design.md`: approved
  source of release requirements; no further implementation changes expected.

### Task 1: Align Release Metadata

**Files:**

- Modify: `package.json`
- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`
- Modify: `packages/shared/package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: the existing private npm workspace graph and package lock.
- Produces: root and workspace package versions equal to `0.1.0`, the API's
  internal `@remote/shared` range equal to `^0.1.0`, no Git tag, and no external
  dependency change.

- [ ] **Step 1: Prove the metadata is not yet release-aligned**

Run:

```bash
docker run --rm \
  -v "$PWD":/app \
  -v remote-platform-node-modules-closure:/app/node_modules \
  -w /app node:22-bookworm-slim \
  npm pkg get version --workspaces --include-workspace-root
```

Expected: all four package versions are `1.0.0`; this is the RED release
metadata check.

- [ ] **Step 2: Update versions mechanically without creating a tag**

Run:

```bash
docker run --rm \
  -v "$PWD":/app \
  -v remote-platform-node-modules-closure:/app/node_modules \
  -w /app node:22-bookworm-slim \
  npm version 0.1.0 --workspaces --include-workspace-root --no-git-tag-version
```

Expected: only the five declared metadata files change. The API's internal
`@remote/shared` range changes from `^1.0.0` to `^0.1.0`; external dependency
versions, integrity values, scripts, and other workspace relationships remain
unchanged.

- [ ] **Step 3: Verify every repository-owned version entry**

Run:

```bash
docker run --rm \
  -v "$PWD":/app \
  -v remote-platform-node-modules-closure:/app/node_modules \
  -w /app node:22-bookworm-slim \
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const files = [
      "package.json",
      "apps/api/package.json",
      "apps/web/package.json",
      "packages/shared/package.json",
    ];
    for (const file of files) {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (value.version !== "0.1.0") throw new Error(`${file}: ${value.version}`);
    }
    const api = JSON.parse(readFileSync("apps/api/package.json", "utf8"));
    if (api.dependencies?.["@remote/shared"] !== "^0.1.0") {
      throw new Error("apps/api internal @remote/shared range mismatch");
    }
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const expected = ["", "apps/api", "apps/web", "packages/shared"];
    for (const key of expected) {
      if (lock.packages[key]?.version !== "0.1.0") {
        throw new Error(`package-lock packages[${key}].version mismatch`);
      }
    }
    if (lock.packages["apps/api"]?.dependencies?.["@remote/shared"] !== "^0.1.0") {
      throw new Error("package-lock API @remote/shared range mismatch");
    }
    console.log("release versions=0.1.0");
  '
```

Expected: `release versions=0.1.0` and exit code 0.

- [ ] **Step 4: Prove the lockfile contains no dependency churn**

Run:

```bash
git diff -- package-lock.json
git diff --check
```

Expected: lockfile changes are limited to the root and three workspace package
version fields plus the API's internal `@remote/shared` range; no external
dependency, resolved URL, integrity, or whitespace changes.

- [ ] **Step 5: Run focused metadata quality checks**

Run:

```bash
docker run --rm \
  -v "$PWD":/app \
  -v remote-platform-node-modules-closure:/app/node_modules \
  -w /app node:22-bookworm-slim \
  sh -lc 'npm run format:check && npm run typecheck'
```

Expected: Prettier and strict TypeScript pass.

- [ ] **Step 6: Commit release metadata**

```bash
git add package.json package-lock.json apps/api/package.json apps/web/package.json packages/shared/package.json
git commit -m "chore: align mvp release version"
```

### Task 2: Publish Accurate Phase 1 Documentation and Qualify the Candidate

**Files:**

- Modify: `README.md`

**Interfaces:**

- Consumes: the approved Phase 1 feature designs, existing scripts, `.env.example`,
  and Compose behavior.
- Produces: durable operator guidance that describes exactly the released
  capabilities, security boundaries, exclusions, commands, and limitations.

- [ ] **Step 1: Prove the README still advertises the old scope**

Run:

```bash
rg -n 'Server deletion, interactive terminal sessions, and all other remote protocols remain outside this release' README.md
```

Expected: one match. This is the RED documentation check because deletion and
interactive terminals are now implemented.

- [ ] **Step 2: Replace the release introduction and add the exact feature list**

Replace the first release paragraph with:

```markdown
MVP Phase 1 (`v0.1.0`) is an authenticated, single-administrator web SSH
platform. It can validate and save password or private-key SSH endpoints, list
and permanently delete saved servers, open up to five browser terminal tabs,
and disconnect sessions. Saved credentials stay encrypted in the API data
store; public server responses never include them.
```

Immediately after it, add:

```markdown
## MVP Phase 1

- Administrator login with an HttpOnly JWT cookie and per-source rate limit
- Create and validate password or private-key SSH servers
- List saved public server records and stored host-key fingerprints
- Permanently delete inactive servers after accessible confirmation
- Browser SSH terminals with up to five tabs per administrator
- Explicit disconnect with immediate WebSocket, SSH, and reservation cleanup
- Sanitized audit records for server and terminal operations

SFTP, RDP, VNC, MFA, teams, port forwarding, jump hosts, session recording,
horizontal API scaling, and restore workflows are not part of this release.
```

- [ ] **Step 3: Add the operator workflow without exposing credential material**

Add a `## Using the platform` section before `## Docker` with these steps:

```markdown
## Using the platform

1. Sign in with the configured administrator account.
2. Create a server using password or private-key authentication. The API tests
   the SSH endpoint before saving it.
3. Compare the displayed SHA-256 host-key fingerprint with a trusted source.
4. Open saved servers in Terminal and switch between terminal tabs as needed.
5. Disconnect a terminal tab when work is complete.
6. Disconnect every terminal using a server before deleting that server.

Deleting a server is permanent and also removes its encrypted credential. A
server with an active or connecting terminal returns a conflict response and is
not deleted.
```

- [ ] **Step 4: Correct build, health, test, and release guidance**

Make these bounded README changes:

- State that the Docker URL is `http://localhost:${WEB_PORT:-8080}` and that the
  actual value comes from `.env`.
- Add `curl -fsS http://localhost:${WEB_PORT:-8080}/health` after `docker compose
ps`.
- Add `npm run format:check` as the first Quality Gate command.
- State that Playwright covers create, guarded delete, multiple terminal tabs,
  disconnect, and desktop/mobile layouts with an in-process SSH fixture.
- Add a `## Security and limitations` section that documents credential
  encryption at rest, HttpOnly JWT cookies, exact Origin validation, sanitized
  audit boundaries, reverse-proxy TLS requirements, TOFU, and the single API
  instance/in-memory session and login-limit constraint.
- Preserve the existing secure secret-generation, proxy-trust, and SQLite-volume
  guidance unless wording must move to avoid duplication.
- Add `## Release evidence` linking to
  `docs/releases/v0.1.0-checklist.md` without hardcoding test totals or a commit
  SHA in README.

- [ ] **Step 5: Verify the new documentation contract**

Run:

```bash
test -z "$(rg -l 'Server deletion, interactive terminal sessions, and all other remote protocols remain outside this release' README.md)"
rg -n '^## MVP Phase 1$|^## Using the platform$|^## Security and limitations$|^## Release evidence$' README.md
rg -n 'Create and validate|Permanently delete|five tabs|Disconnect|v0.1.0-checklist.md' README.md
docker run --rm \
  -v "$PWD":/app \
  -v remote-platform-node-modules-closure:/app/node_modules \
  -w /app node:22-bookworm-slim \
  npx prettier --check README.md
git diff --check
```

Expected: the stale sentence is absent; all four headings and all five
capability/evidence phrases are present; Prettier and whitespace checks pass.

- [ ] **Step 6: Run the complete Node.js candidate gate**

Run:

```bash
docker run --rm \
  -v "$PWD":/app \
  -v remote-platform-node-modules-closure:/app/node_modules \
  -w /app node:22-bookworm-slim \
  sh -lc 'npm run format:check && npm run lint && npm run typecheck && npm test && npm run build'
```

Expected: format, lint, strict typecheck, 180 API tests, 46 web tests, 31
shared tests, and all three production builds pass.

- [ ] **Step 7: Run the complete desktop/mobile browser gate**

Prepare the Playwright ABI-specific volume once:

```bash
docker run --rm \
  -v "$PWD":/app \
  -v remote-platform-node-modules-closure-pw:/app/node_modules \
  -w /app mcr.microsoft.com/playwright:v1.61.1-noble npm ci
```

Then run:

```bash
docker run --rm \
  -e HOME=/tmp \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$PWD":/app \
  -v remote-platform-node-modules-closure-pw:/app/node_modules \
  -w /app mcr.microsoft.com/playwright:v1.61.1-noble npm run test:e2e
```

Expected: 5 Playwright tests pass across desktop and mobile Chromium, including
the guarded-delete terminal flow.

- [ ] **Step 8: Run security and repository-hygiene gates**

Run:

```bash
docker run --rm \
  -v "$PWD":/app \
  -v remote-platform-node-modules-closure:/app/node_modules \
  -w /app node:22-bookworm-slim \
  npm audit --omit=dev --audit-level=high
test -z "$(git ls-files -- '.env' '*.sqlite' 'playwright-report/**' 'test-results/**')"
git diff --check
git status --short --branch
```

Expected: zero high/critical production dependency vulnerabilities, no tracked
environment/database/browser artifacts, no whitespace errors, and only the
intended README change remains uncommitted.

- [ ] **Step 9: Commit the qualified README**

```bash
git add README.md
git commit -m "docs: document mvp phase one"
```

### Task 3: Integrate, Record Release Evidence, and Deploy

**Files:**

- Create: `docs/releases/v0.1.0-checklist.md`

**Interfaces:**

- Consumes: reviewed branch `docs/mvp-phase1-closure`, ignored main-checkout
  `.env`, `SMOKE_ADMIN_PASSWORD`, Compose services, Git remote `origin`.
- Produces: a clean, verified local `main`, healthy production Compose services,
  and committed sanitized release evidence. It does not push or tag.

- [ ] **Step 1: Confirm the branch and tag preconditions**

From the worktree, run:

```bash
git status --short --branch
git diff main...HEAD --check
git tag --list v0.1.0
git ls-remote --tags origin refs/tags/v0.1.0
```

Expected: clean `docs/mvp-phase1-closure`, no whitespace errors, and no local or
remote `v0.1.0` output. If the tag exists, stop; never move or replace it.

- [ ] **Step 2: Obtain candidate-branch independent review**

Review `main...HEAD` against
`docs/superpowers/specs/2026-07-20-mvp-phase-1-closure-design.md`. The review
must explicitly confirm:

- Only approved documentation and release metadata changed.
- All root/workspace owned versions equal `0.1.0`, the API's internal
  `@remote/shared` range equals `^0.1.0`, and the lockfile has no external
  dependency churn.
- README capability, security, exclusion, command, health, and limitation claims
  match actual code and Compose behavior.
- No secret, environment file, test artifact, runtime contract, migration, or
  application behavior changed.

Expected verdict: `READY TO MERGE`. Fix Important findings and re-review before
continuing.

- [ ] **Step 3: Fast-forward the reviewed branch into main**

From `/Users/tanawatnoipalee/App_Max/Remote`, run:

```bash
git status --short --branch
git fetch origin
git rev-parse main
git rev-parse origin/main
git merge --ff-only docs/mvp-phase1-closure
```

Expected before merge: main is clean and equals `origin/main`. If origin moved,
stop and review/rebase instead of merging blindly. Expected after merge: a
fast-forward containing only the reviewed commits.

- [ ] **Step 4: Run the complete release gates on merged main**

Run from the main checkout:

```bash
docker run --rm \
  -v "$PWD":/app \
  -v remote-platform-node-modules:/app/node_modules \
  -w /app node:22-bookworm-slim \
  sh -lc 'npm run format:check && npm run lint && npm run typecheck && npm test && npm run build'
docker run --rm \
  -e HOME=/tmp \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$PWD":/app \
  -v remote-platform-node-modules-pw:/app/node_modules \
  -w /app mcr.microsoft.com/playwright:v1.61.1-noble npm run test:e2e
docker compose config --quiet
```

Expected: 257 Vitest tests, 5 Playwright tests, all static checks/builds, and
Compose validation pass.

- [ ] **Step 5: Rebuild production without deleting SQLite data**

Run:

```bash
docker compose up -d --build
docker compose ps
```

Load `WEB_PORT` without printing any `.env` value and verify:

```bash
set -a
source .env
set +a
curl -fsS "http://localhost:${WEB_PORT:-8080}/health"
```

Expected: API and web report healthy and the health body is exactly `healthy`.
Do not run `docker compose down -v` against the production project.

- [ ] **Step 6: Run authenticated create/delete smoke with an ephemeral SSH fixture**

Read the administrator password without echoing it:

```bash
set -a
source .env
set +a
read -rs "SMOKE_ADMIN_PASSWORD?Admin password: "
export SMOKE_ADMIN_PASSWORD
SMOKE_SSH_PASSWORD=$(openssl rand -base64 24)
export SMOKE_SSH_PASSWORD
```

Start the fixture on the production Compose network:

```bash
docker run -d --rm \
  --name remote-v010-smoke-ssh \
  --network remote_default \
  -e SMOKE_SSH_PASSWORD \
  -v "$PWD":/app \
  -v remote-platform-node-modules:/app/node_modules \
  -w /app node:22-bookworm-slim \
  node --input-type=module -e '
    import { generateKeyPairSync } from "node:crypto";
    import ssh2 from "ssh2";
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs1" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
      client.on("authentication", (context) => {
        if (
          context.method === "password" &&
          context.username === "smoke" &&
          context.password === process.env.SMOKE_SSH_PASSWORD
        ) context.accept();
        else context.reject();
      });
    });
    server.listen(2222, "0.0.0.0", () => console.log("ready"));
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
  '
```

Wait for the exact `ready` line, then run the following in one shell so cleanup
always removes temporary files and the owned fixture container:

```bash
set -euo pipefail
headers=$(mktemp)
create_body=$(mktemp)
cleanup() {
  rm -f "$headers" "$create_body"
  docker rm -f remote-v010-smoke-ssh >/dev/null 2>&1 || true
  unset SMOKE_ADMIN_PASSWORD SMOKE_SSH_PASSWORD
}
trap cleanup EXIT

until docker logs remote-v010-smoke-ssh 2>&1 | grep -q '^ready$'; do
  sleep 1
done

login_code=$(jq -n \
  --arg username "$ADMIN_USERNAME" \
  --arg password "$SMOKE_ADMIN_PASSWORD" \
  '{username: $username, password: $password}' | \
  curl -sS -D "$headers" -o /dev/null -w '%{http_code}' \
    -H "Origin: $ALLOWED_ORIGIN" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
    "http://localhost:${WEB_PORT:-8080}/api/v1/auth/login")
test "$login_code" = 200

cookie=$(awk '
  tolower($0) ~ /^set-cookie: remote_session=/ {
    sub(/^[^:]*:[[:space:]]*/, "");
    split($0, parts, ";");
    print parts[1];
    exit;
  }
' "$headers" | tr -d '\r')
test -n "$cookie"

name="v0.1.0 release smoke $(date +%s)"
create_code=$(jq -n \
  --arg name "$name" \
  --arg ssh_password "$SMOKE_SSH_PASSWORD" '
  {
    name: $name,
    host: "remote-v010-smoke-ssh",
    port: 2222,
    username: "smoke",
    authType: "password",
    password: $ssh_password
  }
' | curl -sS -o "$create_body" -w '%{http_code}' \
  -H "Origin: $ALLOWED_ORIGIN" \
  -H "Cookie: $cookie" \
  -H 'Content-Type: application/json' \
  --data-binary @- \
  "http://localhost:${WEB_PORT:-8080}/api/v1/servers")
test "$create_code" = 201

server_id=$(jq -er .id "$create_body")
delete_code=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE \
  -H "Origin: $ALLOWED_ORIGIN" \
  -H "Cookie: $cookie" \
  "http://localhost:${WEB_PORT:-8080}/api/v1/servers/$server_id")
test "$delete_code" = 204
printf 'login=%s create=%s delete=%s\n' \
  "$login_code" "$create_code" "$delete_code"
```

Expected sanitized output: `login=200 create=201 delete=204`. No credential,
cookie, response body, or environment value is printed. Confirm the fixture is
absent afterward with `docker ps --filter name=remote-v010-smoke-ssh`.

- [ ] **Step 7: Create the completed release checklist**

Create `docs/releases/v0.1.0-checklist.md` with this exact structure and mark a
row `Pass` only for evidence observed in Steps 4-6:

```markdown
# Web Remote Platform v0.1.0 Release Checklist

**Date:** 2026-07-20
**Decision:** Pass

## Scope

MVP Phase 1 includes administrator login, create/list/delete server, browser SSH
terminal, up to five terminal tabs, disconnect, and sanitized server/terminal
audit events. Phase 2 protocols and team features remain excluded.

## Acceptance

| Capability                                 | Result |
| ------------------------------------------ | ------ |
| Admin login and rate limit                 | Pass   |
| Password/private-key server creation       | Pass   |
| Public server listing                      | Pass   |
| Guarded atomic server deletion             | Pass   |
| SSH Web Terminal and host-key verification | Pass   |
| Multi-tab session isolation                | Pass   |
| Disconnect and reservation cleanup         | Pass   |
| Sanitized server/terminal audit events     | Pass   |

## Automated Gates

| Gate                                                   | Result |
| ------------------------------------------------------ | ------ |
| Prettier                                               | Pass   |
| ESLint                                                 | Pass   |
| TypeScript strict checks                               | Pass   |
| Vitest: API 180, web 46, shared 31 (257 total)         | Pass   |
| Production builds: shared, API, web                    | Pass   |
| Playwright: desktop/mobile (5 total)                   | Pass   |
| Production dependency audit: no high/critical findings | Pass   |
| Repository artifact and whitespace checks              | Pass   |

## Deployment Gates

| Gate                                      | Result |
| ----------------------------------------- | ------ |
| Docker Compose configuration              | Pass   |
| API container health                      | Pass   |
| Web container health                      | Pass   |
| Reverse-proxy health response             | Pass   |
| Authenticated login smoke: HTTP 200       | Pass   |
| Create-server smoke: HTTP 201             | Pass   |
| Delete-server smoke: HTTP 204             | Pass   |
| Disposable SSH fixture and server cleanup | Pass   |

## Accepted MVP Limitations

- SSH trust starts with TOFU; operators verify first-use fingerprints out of band.
- Session reservations and login rate limits are in memory in one API process.
- Horizontal API scaling, restore, SFTP, RDP, VNC, MFA, teams, port forwarding,
  jump hosts, and session recording are outside this release.

No password, cookie, JWT, private key, passphrase, encryption key, encrypted
credential, terminal content, `.env` value, or database content was recorded as
release evidence.
```

If any expected count or status differs, set `Decision: Blocked`, record only the
sanitized failing gate, do not create the release tag, and start the approved
defect workflow.

- [ ] **Step 8: Commit evidence and rerun final gates on the exact candidate**

Run:

```bash
docker run --rm \
  -v "$PWD":/app \
  -v remote-platform-node-modules:/app/node_modules \
  -w /app node:22-bookworm-slim \
  npx prettier --write docs/releases/v0.1.0-checklist.md
git add docs/releases/v0.1.0-checklist.md
git commit -m "docs: record v0.1.0 release qualification"
```

Then rerun:

```bash
docker run --rm \
  -v "$PWD":/app \
  -v remote-platform-node-modules:/app/node_modules \
  -w /app node:22-bookworm-slim \
  sh -lc 'npm run format:check && npm run lint && npm run typecheck && npm test && npm run build'
docker run --rm \
  -e HOME=/tmp \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$PWD":/app \
  -v remote-platform-node-modules-pw:/app/node_modules \
  -w /app mcr.microsoft.com/playwright:v1.61.1-noble npm run test:e2e
docker compose up -d --build
docker compose ps
set -a
source .env
set +a
curl -fsS "http://localhost:${WEB_PORT:-8080}/health"
git diff --check
git status --short --branch
```

Expected: every gate passes on the exact final commit, both services remain
healthy, health returns `healthy`, and main is clean.

### Task 4: Review and Publish the Immutable Release

**Files:**

- No repository file changes are expected.

**Interfaces:**

- Consumes: local `main` with committed `docs/releases/v0.1.0-checklist.md`,
  completed Task 3 verification evidence, healthy production Compose services,
  and Git remote `origin`.
- Produces: reviewed and pushed `origin/main`, annotated tag `v0.1.0` resolving
  to the same commit, and cleanup of only the owned release worktree/branch.

- [ ] **Step 1: Review the complete final commit before publication**

Review `b164925...main` against
`docs/superpowers/specs/2026-07-20-mvp-phase-1-closure-design.md`, including the
release checklist added after merge. The reviewer must inspect the complete diff
and the Task 3 report and explicitly confirm:

- Package and lockfile versions are exactly `0.1.0`, the API's internal
  `@remote/shared` range is `^0.1.0`, and there is no external dependency churn.
- README claims match the implemented REST, WebSocket, security, Docker, and
  test behavior.
- Every checklist `Pass` row has corresponding sanitized command evidence.
- No secret, user database, runtime contract, migration, application source,
  generated artifact, or unrelated work changed.
- Final format, lint, strict typecheck, Vitest, build, Playwright, Compose health,
  login/create/delete smoke, cleanup, and Git cleanliness gates passed.

Expected verdicts: `SPEC COMPLIANCE: PASS`, `CODE QUALITY: PASS`, and
`READY TO PUBLISH`. Any Critical or Important finding blocks publication; fix
and re-review before continuing.

- [ ] **Step 2: Reconfirm tag and repository preconditions**

Run:

```bash
git status --short --branch
git diff --check
git tag --list v0.1.0
git ls-remote --tags origin refs/tags/v0.1.0
```

Expected: clean local main, no whitespace errors, and no local or remote tag
output. If the tag exists, stop and do not move, delete, or replace it.

- [ ] **Step 3: Push main and publish the immutable annotated tag**

Run:

```bash
git push origin main
git tag -a v0.1.0 -m "Web Remote Platform MVP Phase 1 v0.1.0"
git push origin v0.1.0
```

Verify all identities without changing history:

```bash
git fetch origin
test "$(git rev-parse main)" = "$(git rev-parse origin/main)"
test "$(git rev-parse main)" = "$(git rev-list -n 1 v0.1.0)"
git status --short --branch
docker compose ps
set -a
source .env
set +a
curl -fsS "http://localhost:${WEB_PORT:-8080}/health"
```

Expected: `main`, `origin/main`, and `v0.1.0` resolve to one commit; main is
clean; production API and web remain healthy.

- [ ] **Step 4: Clean the owned release worktree after successful publication**

From `/Users/tanawatnoipalee/App_Max/Remote`, remove only the worktree created
for this release and delete only its merged branch:

```bash
git worktree remove /Users/tanawatnoipalee/App_Max/Remote/.worktrees/mvp-phase1-closure
git worktree prune
git branch -d docs/mvp-phase1-closure
git worktree list
```

Expected: the release worktree and merged docs branch are gone;
`.worktrees/create-server` remains registered and unchanged.
