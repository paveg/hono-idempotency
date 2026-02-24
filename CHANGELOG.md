# hono-idempotency

## 0.7.0

### Minor Changes

- [#72](https://github.com/paveg/hono-idempotency/pull/72) [`788aeeb`](https://github.com/paveg/hono-idempotency/commit/788aeeb27a5a81d37e96a1a77186681451fd955e) Thanks [@paveg](https://github.com/paveg)! - Add hono-problem-details as optional peerDependency with runtime fallback

  - Declare `hono-problem-details` as optional peerDependency
  - When installed: error responses use `problemDetails().getResponse()` from hono-problem-details
  - When not installed: falls back to existing self-contained implementation
  - Detection is lazy (first error path only) — no overhead on happy path
  - Public API (`problemResponse`, `ProblemDetail`, `IdempotencyErrors`) unchanged

## 0.6.0

### Minor Changes

- [`dd2334a`](https://github.com/paveg/hono-idempotency/commit/dd2334a4257d2bd5835a720c6b7e216c766beb15) Thanks [@paveg](https://github.com/paveg)! - Add Redis store adapter (`redisStore`) and Durable Objects store adapter (`durableObjectStore`)

  - **Redis**: Atomic locking via `SET NX EX`, compatible with ioredis, node-redis, and @upstash/redis
  - **Durable Objects**: Leverages DO single-writer model for guaranteed lock atomicity
  - Add Typed RPC Client documentation for `IdempotencyEnv` with `hc<AppType>`

## 0.5.1

### Patch Changes

- [`9928b0d`](https://github.com/paveg/hono-idempotency/commit/9928b0d070e2927b9180f9996cd2ada26fade989) Thanks [@paveg](https://github.com/paveg)! - Export `MemoryStoreOptions` type for API consistency, add `sideEffects: false` for tree-shaking, and add `isolatedModules` for esbuild compatibility

## 0.5.0

### Minor Changes

- [#43](https://github.com/paveg/hono-idempotency/pull/43) [`2927185`](https://github.com/paveg/hono-idempotency/commit/29271857862475f4350c50d1016cc6a1922c400c) Thanks [@paveg](https://github.com/paveg)! - Export `problemResponse` for selective `onError` customization, add store selection guide, and improve JSDoc

## 0.4.0

### Minor Changes

- [#33](https://github.com/paveg/hono-idempotency/pull/33) [`e7b92de`](https://github.com/paveg/hono-idempotency/commit/e7b92debff8630df7121b3a58c6cece4e753301a) Thanks [@paveg](https://github.com/paveg)! - Add store.purge() for expired record cleanup, error codes on ProblemDetail, and docs improvements

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
