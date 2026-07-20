# Web Remote Platform

MVP Phase 1 (`v0.1.0`) is an authenticated, single-administrator web SSH
platform. It can validate and save password or private-key SSH endpoints, list
and permanently delete saved servers, open up to five browser terminal tabs,
and disconnect sessions. Saved credentials stay encrypted in the API data
store; public server responses never include them.

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

## Prerequisites

- Node.js 22 or newer and npm for local development
- Chromium installed through Playwright for end-to-end tests
- Docker with Compose for the production-style deployment
- OpenSSL for secret generation

Install dependencies and the browser:

```bash
npm ci
npx playwright install chromium
```

## Configuration

Generate an Argon2id hash after `npm ci`. Replace the example password before running the command:

```bash
node --input-type=module -e 'import argon2 from "argon2"; console.log(await argon2.hash(process.argv[1], { type: argon2.argon2id }))' 'choose-a-password'
```

Put the complete generated hash inside single quotes in `.env`. Argon2 hashes contain `$` characters, and the quotes prevent Compose interpolation from changing them:

```dotenv
ADMIN_PASSWORD_HASH='$argon2id$...generated-output...'
```

Generate independent runtime secrets:

```bash
openssl rand -base64 32  # CREDENTIAL_ENCRYPTION_KEY
openssl rand -base64 48  # JWT_SECRET
```

Copy `.env.example` to `.env` and set `ADMIN_USERNAME`, the single-quoted `ADMIN_PASSWORD_HASH`, `CREDENTIAL_ENCRYPTION_KEY`, `JWT_SECRET`, and `ALLOWED_ORIGIN`. The example file intentionally contains no usable credentials or secrets. Keep the encryption key stable: losing or rotating it without a migration makes stored credentials unreadable.

For local development, also set:

```bash
export NODE_ENV=development
export ALLOWED_ORIGIN=http://localhost:5173
export DATABASE_PATH=./remote.sqlite
```

Export the five required values from `.env`, then run:

```bash
npm run dev
```

The Vite application is available at `http://localhost:5173`; it proxies `/api/*` to the API on port 3000.

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

## Docker

With the required values populated in `.env`:

```bash
docker compose config
docker compose build
docker compose up -d
docker compose ps
curl -fsS http://localhost:${WEB_PORT:-8080}/health
```

Open `http://localhost:${WEB_PORT:-8080}`; the actual port value comes from
`.env`. The web container is an unprivileged Nginx process and proxies `/api/*`
to the non-root API container. SQLite data is stored in the `remote-data` named
volume.

For production, terminate TLS in a trusted reverse proxy in front of the web container and set `ALLOWED_ORIGIN` to the exact public HTTPS origin, for example `https://remote.example.com` (no trailing slash or path). The TLS proxy must set `X-Forwarded-Proto: https`. Nginx discards inbound `X-Forwarded-For` values and reports its direct peer to the API. Fastify trusts only loopback, RFC1918, and IPv6 ULA proxy addresses, so direct public peers cannot spoof login-limit or audit identity. By default an external TLS terminator is therefore the recorded source IP. Accurate end-client attribution through that terminator requires a deployment-specific Nginx `set_real_ip_from` rule limited to the terminator's exact stable address; never trust a broad private range. Do not publish the API container directly: Compose intentionally exposes only the web service. Production session cookies remain `Secure`.

Login limiting is an in-memory, single-API-process rolling window: each source IP gets five attempts per 15 minutes. It is not shared across replicas. The store caps live source keys at 5,000 and fails closed for previously unseen sources while at capacity; operators must monitor repeated `429` responses and restart only after investigating abusive traffic.

Stop the deployment without deleting its database volume:

```bash
docker compose down
```

## Quality Gate

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Playwright covers create, guarded delete, multiple terminal tabs, disconnect,
and desktop/mobile layouts with an in-process SSH fixture. Its loopback SSH
fixture generates host and client RSA keys at runtime; the administrator hash
and generated private key remain in test-process memory and are not written to
disk.

## Security and limitations

Credentials are encrypted at rest in the API data store. Authentication uses an
HttpOnly JWT cookie, and state-changing API requests and terminal upgrades
require an exact configured Origin. Audit records contain sanitized operation
metadata only: they do not include credentials or terminal content.

For non-local deployments, a trusted reverse proxy must terminate TLS and set
the exact public HTTPS origin. The API supports one instance only: terminal
session reservations and the per-source login limit are stored in memory, so
they are not coordinated across replicas.

## SSH Trust

This release uses Trust On First Use (TOFU): the first successful SSH connection captures and stores the endpoint's host key and shows its SHA-256 fingerprint. TOFU does not protect that first connection from a man-in-the-middle attack. Operators must compare the displayed fingerprint with a trusted out-of-band source before relying on the saved server record.

## Release evidence

The release acceptance matrix and sanitized qualification results are recorded
in [the v0.1.0 release checklist](docs/releases/v0.1.0-checklist.md).
