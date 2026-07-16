# Web Remote Platform

This repository delivers the first create-server workflow: one configured administrator can sign in, test an SSH endpoint with a password or private key, and persist the server only after authentication succeeds. The saved endpoint includes the captured host-key fingerprint. Server listing, deletion, interactive sessions, and all other remote protocols are outside this release.

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

Copy `.env.example` to `.env` and set `ADMIN_USERNAME`, the single-quoted `ADMIN_PASSWORD_HASH`, `CREDENTIAL_ENCRYPTION_KEY`, and `JWT_SECRET`. The example file intentionally contains no usable credentials or secrets. Keep the encryption key stable: losing or rotating it without a migration makes stored credentials unreadable.

For local development, also set:

```bash
export NODE_ENV=development
export ALLOWED_ORIGIN=http://localhost:5173
export DATABASE_PATH=./remote.sqlite
```

Export the four required values from `.env`, then run:

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
