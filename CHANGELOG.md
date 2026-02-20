# hono-idempotency

## 0.1.0

### Minor Changes

- [`2b73a76`](https://github.com/paveg/hono-idempotency/commit/2b73a76dd8a1bc10bb4cc30eb10e27106d7d1c67) Thanks [@paveg](https://github.com/paveg)! - Add `skipRequest`, `cacheKeyPrefix`, and `onError` middleware options

  - **`skipRequest`**: Per-request opt-out from idempotency (e.g., health checks)
  - **`cacheKeyPrefix`**: Multi-tenant key isolation via static string or dynamic function
  - **`onError`**: Custom error response handling with access to `ProblemDetail`
