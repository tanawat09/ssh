# Task 1 Report

Status: DONE_WITH_CONCERNS

Implemented `ServerRepository.listAll()` with a public-column-only query ordered by `created_at ASC`, plus `ApiClient.listServers()` using credentialed `GET /api/v1/servers`.

Tests added for ordering, DTO secret exclusion, and GET request options. Focused tests could not run in this environment because `npm` and `node` are unavailable (`command not found`). `git diff --check` passed.
