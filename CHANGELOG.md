# hono-idempotency

## 0.3.0

### Minor Changes

- [#28](https://github.com/paveg/hono-idempotency/pull/28) [`ce6e957`](https://github.com/paveg/hono-idempotency/commit/ce6e95771ee3dd0ccec262a00b5b58efe2aba0d6) Thanks [@paveg](https://github.com/paveg)! - Add `maxSize` option to memory store, fix `IdempotencyEnv` type safety, export `MemoryStore` type

## 0.2.1

### Patch Changes

- [#20](https://github.com/paveg/hono-idempotency/pull/20) [`374ad55`](https://github.com/paveg/hono-idempotency/commit/374ad557639a5712786ac6fe7b36ae4d984a3d9e) Thanks [@paveg](https://github.com/paveg)! - Add TTL support and table name validation to D1 store

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
