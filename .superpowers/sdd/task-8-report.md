# Task 8 Report: Vue Login And Create Server Experience

## Implemented

- Added the Vue 3, Vite, strict TypeScript, Pinia, Vue Router, Tailwind CSS, and Lucide web workspace.
- Added a typed same-origin API client that always sends `credentials: 'include'` and maps stable public API errors without reading or storing JWTs.
- Added an in-memory session store and protected route guard. A protected `401` clears session state and returns the user to `/login`.
- Added an accessible admin login view with stable pending state, form-level errors, and password cleanup.
- Added the responsive `/servers/new` workflow with password/private-key segmented selection, conditional secret fields, field/form errors, stable `Test & Save` state, non-secret success details, and host-key fingerprint output.
- Added a reusable secret input with Lucide visibility icons, accessible labels, and tooltips.
- Secrets are copied into the request payload and all component-held secret refs are cleared in `finally`; public connection fields remain populated.

## Test-Driven Development

- Initial RED: five suites failed because the API client, session store, component, and views did not exist.
- Expired-session RED: the new `401` navigation test failed because no login redirect occurred.
- GREEN: 5 web test files now pass 13 tests covering API credentials/errors, session decisions, secret visibility, login states, auth field exclusivity, failure cleanup, success output, and expired-session redirect.

## Verification

Executed in Docker Node 22 with the named `remote_task8_node_modules` volume:

- `npm test`: API 92/92, web 13/13, shared 9/9 passed.
- `npm run typecheck`: all workspaces passed.
- `npm run lint`: passed.
- `npm run build`: all workspace builds passed; Vite production bundle completed.
- `prettier --check apps/web`: passed.
- `git diff --check`: passed on the host because the Node Alpine image does not include Git.

Browser and Playwright visual QA were intentionally not run because Task 9 owns that verification.

## Self-Review

- No JWT or SSH credential persistence was introduced.
- Successful responses render only the credential-free `ServerDto` fields.
- No list, delete, terminal, session-management, or marketing behavior was added.
- Controls have stable heights, radii are at most 6px, letter spacing is zero, and responsive tracks prevent narrow-screen overlap.
