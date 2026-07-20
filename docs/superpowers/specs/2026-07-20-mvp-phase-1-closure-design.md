# MVP Phase 1 Closure Design

**Date:** 2026-07-20
**Status:** Approved

## Goal

Formally qualify and release the completed Web Remote Platform MVP Phase 1 as
`v0.1.0`. The closure work proves that the approved login, server-management,
and browser SSH-terminal workflows operate together, updates stale release
documentation, and records reproducible evidence for the release decision.

This is a release-qualification change, not a new product feature. Runtime
behavior remains unchanged unless a release gate exposes a reproducible defect.
Any such defect stops the release and must be handled as a separately analyzed,
test-driven fix before qualification resumes.

## Scope

This closure includes:

- An acceptance matrix for every MVP Phase 1 workflow.
- Verification of the existing security invariants.
- Complete formatting, lint, typecheck, unit, integration, E2E, and production
  build gates.
- Docker Compose configuration, health, and authenticated public-API smoke
  verification.
- README correction so documented capabilities and commands match the release.
- A committed `v0.1.0` release checklist containing commands and sanitized
  results.
- Release metadata aligned to version `0.1.0`.
- An annotated `v0.1.0` Git tag pushed only after all gates pass on `main`.

This closure excludes SFTP, RDP, VNC, MFA, teams, port forwarding, jump hosts,
session recording, horizontal scaling, backup automation, load testing, and
secret rotation. Those remain future phases.

## Release Artifacts

The implementation produces only release and documentation artifacts unless a
blocking defect is found:

- `README.md`, updated to describe the complete Phase 1 capability and current
  build, test, run, security, and limitation information.
- `docs/releases/v0.1.0-checklist.md`, containing the acceptance matrix, exact
  verification commands, sanitized results, deployment health, and release
  decision.
- Root and workspace package metadata set to `0.1.0`, with the lockfile updated
  mechanically so the repository metadata matches the Git tag.
- An annotated Git tag named `v0.1.0` on the exact verified `main` commit.

No secret, cookie, password, private key, passphrase, encryption key, JWT,
encrypted credential, terminal content, or raw environment file is written to
the checklist, README, Git history, command output excerpts, or tag message.

## Feature Acceptance Matrix

Every row must have automated evidence and, where specified, deployment smoke
evidence before the release can pass.

| Capability         | Required acceptance evidence                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin login        | Valid credentials create an HttpOnly, SameSite=Strict JWT session; invalid credentials are generic and rate limited.                                        |
| Create Server      | Password and private-key endpoints are tested before persistence; saved DTOs and responses contain no credentials.                                          |
| List Server        | Authenticated users receive only public server fields and the UI covers loading, empty, error, and populated states.                                        |
| Delete Server      | Confirmation is required; inactive servers and credentials are deleted atomically with audit; active or connecting terminals return the stable 409 result.  |
| SSH Web Terminal   | Authenticated WebSocket sessions use saved encrypted credentials only on the API, verify the stored host key, and close SSH when the browser socket closes. |
| Multi-tabs         | Up to five sessions per actor can be managed without terminal state crossing tabs.                                                                          |
| Disconnect Session | User disconnect closes the WebSocket and SSH channel and releases the reservation.                                                                          |
| Audit              | Server create/list/delete and terminal connect/disconnect events contain sanitized metadata and no secret or terminal data.                                 |

The existing desktop and mobile Playwright flows are the browser-level proof.
The guarded-delete E2E must demonstrate the integrated sequence: create server,
open terminal, receive 409 while active, disconnect, delete successfully, and
observe the row disappear.

## Security Qualification

Release qualification verifies these invariants without weakening or bypassing
them:

- Passwords, private keys, and passphrases are never stored as plaintext.
- Credential encryption remains authenticated encryption at rest, and the
  encryption key is supplied only through runtime configuration.
- Private keys and decrypted credentials never reach the frontend or public
  DTOs.
- JWT authentication and permission validation protect REST and WebSocket
  operations.
- Exact Origin validation remains enabled for state-changing requests and the
  terminal upgrade.
- TLS validation is not disabled. The reverse proxy deployment is expected to
  terminate TLS for non-local use.
- Stored host-key fingerprints are enforced after first-use acceptance.
- Audit metadata is sanitized and does not contain raw payloads or secrets.
- Active and connecting terminal reservations block server deletion across all
  actors in the single API process.
- Repository and generated artifacts contain no committed `.env`, database,
  Playwright trace, screenshot, cookie jar, or temporary credential file.

The accepted MVP security limitations remain explicit: first-use host-key
acceptance is TOFU, session state and login-rate-limit state are in memory, and
the release supports one API instance rather than distributed coordination.

## Release Gates

The following gates run from a clean candidate commit using the locked
dependencies and supported Node.js version:

1. `npm run format:check`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`
6. `npm run test:e2e`
7. `docker compose config --quiet`
8. `docker compose up -d --build`
9. `docker compose ps` with both API and web services healthy
10. `GET /health` through the published web port returning `healthy`
11. Authenticated login, create-server, and delete-server smoke through the
    public reverse-proxy path, using an ephemeral SSH fixture on the Compose
    network
12. `git diff --check` and a clean `git status`

The checklist records exit status, test totals, service health, and HTTP status
codes only. Authentication material is injected at runtime and never echoed.
The disposable server and SSH fixture are removed after smoke verification,
including failure cleanup.

## Failure Handling

The release is fail closed:

- Any format, lint, typecheck, test, E2E, build, Compose, health, authentication,
  create, delete, security, or cleanliness failure blocks the tag.
- A reproducible runtime defect is documented, analyzed for impact, and fixed
  under a separately approved TDD plan. Qualification restarts from the full
  gate set after the fix.
- An environmental failure is distinguished from a product failure with
  concrete evidence. The gate is rerun only after the environment is corrected.
- Existing production containers stay on the last verified image if candidate
  deployment or smoke verification fails.
- The tag is never moved or force-pushed. If a problem is found after publishing,
  a new patch version is required.

## Documentation

The README becomes the operator entry point for Phase 1 and must document:

- The exact implemented feature set and excluded future features.
- Architecture and single-instance constraints.
- Required configuration names without usable secrets.
- Local and Docker build/run/test commands.
- The published port and health check.
- Credential encryption, JWT cookie, Origin validation, audit boundaries, TOFU,
  and reverse-proxy TLS expectations.
- The safe workflow for connecting to multiple saved servers and disconnecting
  before deletion.
- A link to the committed `v0.1.0` checklist.

The checklist is evidence for one release, while the README contains durable
operator guidance. Test counts belong in the checklist, not in the README. The
final immutable commit identity is recorded by the annotated tag and verified
with Git commands during publication; the committed checklist does not attempt
to contain its own commit SHA.

## Versioning and Publication

The root package, API, web, and shared workspace versions are aligned to
`0.1.0`. This is metadata-only and does not change API versioning; public HTTP
routes remain under `/api/v1`.

After the branch is reviewed and merged, the complete release gates run again on
`main`. Only then is `main` pushed and tagged with an annotated `v0.1.0` tag.
The tag is pushed explicitly to `origin` after confirming that `main`,
`origin/main`, and the tag identify the same verified commit. This avoids an
impossible self-referential commit SHA inside the checklist.

No GitHub Release page, binary archive, container registry publication, or
automatic deployment pipeline is added in this closure.

## Backward Compatibility

The closure changes documentation and package version metadata only. It does
not alter REST or WebSocket contracts, database schema, encrypted records,
environment variable names, published Compose ports, authentication, permission
behavior, or existing runtime defaults. Docker volumes and saved SQLite data are
preserved during rebuild and smoke verification.

The release is complete only when every checklist item passes, the candidate
commit is present on `origin/main`, the `v0.1.0` tag points to that commit, and
the Docker Compose API and web services remain healthy.
