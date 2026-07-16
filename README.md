# Web Remote Platform

This release delivers the authenticated create-server and list-server workflows: one configured administrator can sign in, test an SSH endpoint with a password or private key, persist the server only after authentication succeeds, and view saved public server records. The saved endpoint includes the captured host-key fingerprint. Server deletion, interactive terminal sessions, and all other remote protocols remain outside this release.

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

## Docker

With the required values populated in `.env`:

```bash
docker compose config
docker compose build
docker compose up -d
docker compose ps
```

Open `http://localhost:8080`. The web container is an unprivileged Nginx process and proxies `/api/*` to the non-root API container. SQLite data is stored in the `remote-data` named volume.

For production, terminate TLS in a trusted reverse proxy in front of the web container and set `ALLOWED_ORIGIN` to the exact public HTTPS origin, for example `https://remote.example.com` (no trailing slash or path). The TLS proxy must set `X-Forwarded-Proto: https`. Nginx discards inbound `X-Forwarded-For` values and reports its direct peer to the API. Fastify trusts only loopback, RFC1918, and IPv6 ULA proxy addresses, so direct public peers cannot spoof login-limit or audit identity. By default an external TLS terminator is therefore the recorded source IP. Accurate end-client attribution through that terminator requires a deployment-specific Nginx `set_real_ip_from` rule limited to the terminator's exact stable address; never trust a broad private range. Do not publish the API container directly: Compose intentionally exposes only the web service. Production session cookies remain `Secure`.

Login limiting is an in-memory, single-API-process rolling window: each source IP gets five attempts per 15 minutes. It is not shared across replicas. The store caps live source keys at 5,000 and fails closed for previously unseen sources while at capacity; operators must monitor repeated `429` responses and restart only after investigating abusive traffic.

Stop the deployment without deleting its database volume:

```bash
docker compose down
```

## Quality Gate

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Playwright runs the login and create-server flow in desktop Chromium and a mobile viewport. Its loopback SSH fixture generates host and client RSA keys at runtime; the administrator hash and generated private key remain in test-process memory and are not written to disk.

## SSH Trust

This release uses Trust On First Use (TOFU): the first successful SSH connection captures and stores the endpoint's host key and shows its SHA-256 fingerprint. TOFU does not protect that first connection from a man-in-the-middle attack. Operators must compare the displayed fingerprint with a trusted out-of-band source before relying on the saved server record.
