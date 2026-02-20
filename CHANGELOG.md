# hono-idempotency

## 0.2.0

### Minor Changes

- [#15](https://github.com/paveg/hono-idempotency/pull/15) [`6662fb2`](https://github.com/paveg/hono-idempotency/commit/6662fb2957d478b07c2f530b08df2993139ca615) Thanks [@paveg](https://github.com/paveg)! - Add Cloudflare KV and D1 store implementations, memory store GC, CI coverage enforcement

## 0.1.1

### Patch Changes

- [`322bab8`](https://github.com/paveg/hono-idempotency/commit/322bab82be6c86e3c50cf6ce84aec9920fd61316) Thanks [@paveg](https://github.com/paveg)! - Fix release workflow: restore NPM_TOKEN auth, auto-format Version PR with biome

## 0.1.0

### Minor Changes

- [`2b73a76`](https://github.com/paveg/hono-idempotency/commit/2b73a76dd8a1bc10bb4cc30eb10e27106d7d1c67) Thanks [@paveg](https://github.com/paveg)! - Add `skipRequest`, `cacheKeyPrefix`, and `onError` middleware options

  - **`skipRequest`**: Per-request opt-out from idempotency (e.g., health checks)
  - **`cacheKeyPrefix`**: Multi-tenant key isolation via static string or dynamic function
  - **`onError`**: Custom error response handling with access to `ProblemDetail`
