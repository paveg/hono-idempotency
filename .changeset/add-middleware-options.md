---
"hono-idempotency": minor
---

Add `skipRequest`, `cacheKeyPrefix`, and `onError` middleware options

- **`skipRequest`**: Per-request opt-out from idempotency (e.g., health checks)
- **`cacheKeyPrefix`**: Multi-tenant key isolation via static string or dynamic function
- **`onError`**: Custom error response handling with access to `ProblemDetail`
