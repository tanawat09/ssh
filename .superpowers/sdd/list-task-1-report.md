# Task 1 Report

Status: DONE

Implemented `ServerRepository.listAll()` with a public-column-only query ordered by `created_at ASC`, plus `ApiClient.listServers()` using credentialed `GET /api/v1/servers`.

Tests cover creation ordering, the exact public `ServerDto` shape, exclusion of credential and host-key-byte properties, and a representative `ServerDto` API response. `git diff --check` passed.

## Review Fixes

- Strengthened the repository listing assertion to require every public DTO field and explicitly reject `hostKeyBase64`, `encryptedPayload`, `iv`, and `authTag`.
- Updated the API client test to return and assert a representative real `ServerDto` payload.
- Ran Prettier on all changed Task 1 files.
- Re-ran focused tests independently in the Node 22 Bookworm container:

```text
npm test -w @remote/api -- server-repository.test.ts
Test Files  1 passed
Tests       6 passed

npm test -w @remote/web -- api-client.test.ts
Test Files  1 passed
Tests       5 passed
```
