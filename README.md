# hono-idempotency

[![npm version](https://img.shields.io/npm/v/hono-idempotency)](https://www.npmjs.com/package/hono-idempotency)
[![CI](https://github.com/paveg/hono-idempotency/actions/workflows/ci.yml/badge.svg)](https://github.com/paveg/hono-idempotency/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Devin Wiki](https://img.shields.io/badge/Devin-Wiki-blue)](https://app.devin.ai/org/ryota-ikezawa/wiki/paveg/hono-idempotency)

Stripe-style Idempotency-Key middleware for [Hono](https://hono.dev). IETF [draft-ietf-httpapi-idempotency-key-header](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/) compliant.

## Features

- Idempotency-Key header support for POST/PATCH (configurable)
- Request fingerprinting (SHA-256) prevents key reuse with different payloads
- Concurrent request protection with optimistic locking
- RFC 9457 Problem Details error responses with error codes (`MISSING_KEY`, `KEY_TOO_LONG`, `FINGERPRINT_MISMATCH`, `CONFLICT`)
- Replayed responses include `Idempotency-Replayed: true` header
- Non-2xx responses are not cached (Stripe pattern — allows client retry)
- Per-request opt-out via `skipRequest`
- Multi-tenant key isolation via `cacheKeyPrefix`
- Custom error responses via `onError`
- Expired record cleanup via `store.purge()`
- Pluggable store interface (memory, Cloudflare KV, Cloudflare D1)
- Works on Cloudflare Workers, Node.js, Deno, Bun, and any Web Standards runtime

## Install

```bash
# npm
npm install hono-idempotency

# pnpm
pnpm add hono-idempotency
```

## Quick Start

```ts
import { Hono } from "hono";
import { idempotency } from "hono-idempotency";
import { memoryStore } from "hono-idempotency/stores/memory";

const app = new Hono();

app.use("/api/*", idempotency({ store: memoryStore() }));

app.post("/api/payments", (c) => {
  // This handler only runs once per unique Idempotency-Key.
  // Retries with the same key return the cached response.
  return c.json({ id: "pay_123", status: "succeeded" }, 201);
});
```

Client usage:

```bash
curl -X POST http://localhost:3000/api/payments \
  -H "Idempotency-Key: unique-request-id-123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000}'
```

## Options

```ts
idempotency({
  // Required: storage backend
  store: memoryStore(),

  // Header name (default: "Idempotency-Key")
  headerName: "Idempotency-Key",

  // Return 400 if header is missing (default: false)
  required: false,

  // HTTP methods to apply idempotency (default: ["POST", "PATCH"])
  methods: ["POST", "PATCH"],

  // Maximum key length (default: 256)
  maxKeyLength: 256,

  // Custom fingerprint function (default: SHA-256 of method + path + body)
  fingerprint: (c) => `${c.req.method}:${c.req.path}`,

  // Skip idempotency for specific requests
  skipRequest: (c) => c.req.path === "/api/health",

  // Namespace store keys for multi-tenant isolation
  cacheKeyPrefix: (c) => c.req.header("X-Tenant-Id") ?? "default",

  // Custom error response handler (default: RFC 9457 Problem Details)
  onError: (error, c) => c.json({ error: error.title }, error.status),
});
```

### skipRequest

Skip idempotency processing for specific requests. Useful for health checks or internal endpoints.

```ts
idempotency({
  store: memoryStore(),
  skipRequest: (c) => c.req.path === "/api/health",
});
```

### cacheKeyPrefix

Namespace store keys to isolate idempotency state between tenants or environments.

```ts
idempotency({
  store: memoryStore(),
  // Static prefix
  cacheKeyPrefix: "production",

  // Or dynamic per-request prefix
  cacheKeyPrefix: (c) => c.req.header("X-Tenant-Id") ?? "default",
});
```

> **Note:** The callback receives Hono's base `Context`, so accessing typed variables (e.g., `c.get("userId")`) requires a cast: `c.get("userId") as string`.

### onError

Override the default RFC 9457 error responses with a custom handler. Each error includes a `code` field for programmatic identification:

| Code | Status | Description |
|------|--------|-------------|
| `MISSING_KEY` | 400 | `required: true` and no header |
| `KEY_TOO_LONG` | 400 | Key exceeds `maxKeyLength` |
| `CONFLICT` | 409 | Concurrent request with same key |
| `FINGERPRINT_MISMATCH` | 422 | Same key, different request body |

```ts
import type { ProblemDetail } from "hono-idempotency";

idempotency({
  store: memoryStore(),
  onError: (error: ProblemDetail, c) => {
    if (error.code === "FINGERPRINT_MISMATCH") {
      return c.json({ error: "Request body changed" }, 422);
    }
    return c.json({ code: error.code, message: error.title }, error.status);
  },
});
```

## Stores

### Choosing a Store

| | Memory | Cloudflare KV | Cloudflare D1 |
|---|---|---|---|
| **Consistency** | Strong (single-instance) | Eventual | Strong |
| **Durability** | None (process-local) | Durable | Durable |
| **Lock atomicity** | Atomic (in-process Map) | Not atomic across edge locations | Atomic (SQL INSERT OR IGNORE) |
| **TTL** | In-process sweep | Automatic (expirationTtl) | SQL filter on created_at |
| **Setup** | None | KV namespace binding | D1 database binding |
| **Best for** | Development, single-instance | Multi-region, low-contention | Multi-region, strong consistency |

> **Tip:** Start with `memoryStore()` for development. For production on Cloudflare Workers, use `d1Store` when you need strong consistency guarantees, or `kvStore` for simpler deployments where occasional duplicate processing is acceptable.

### Memory Store

Built-in, suitable for single-instance deployments and development.

```ts
import { memoryStore } from "hono-idempotency/stores/memory";

const store = memoryStore({
  ttl: 24 * 60 * 60 * 1000, // 24 hours (default)
  maxSize: 10000, // max entries, oldest evicted first (optional, default: unlimited)
});
```

### Cloudflare KV Store

For Cloudflare Workers with KV. TTL is handled automatically by KV expiration.

```ts
import { kvStore } from "hono-idempotency/stores/cloudflare-kv";

type Bindings = { IDEMPOTENCY_KV: KVNamespace };

const app = new Hono<{ Bindings: Bindings }>();

// Store must be created per-request since KV binding comes from c.env
app.use("/api/*", async (c, next) => {
  const store = kvStore({
    namespace: c.env.IDEMPOTENCY_KV,
    ttl: 86400, // 24 hours in seconds (default)
  });
  return idempotency({ store })(c, next);
});
```

> **Note:** KV is eventually consistent. In rare cases, concurrent requests to different edge locations may both acquire the lock. This is acceptable for most idempotency use cases.

### Cloudflare D1 Store

For Cloudflare Workers with D1. Uses SQL for strong consistency. Table is created automatically.

```ts
import { d1Store } from "hono-idempotency/stores/cloudflare-d1";

type Bindings = { IDEMPOTENCY_DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>();

// Store must be created per-request since D1 binding comes from c.env.
// CREATE TABLE IF NOT EXISTS runs each request but is a no-op after the first.
app.use("/api/*", async (c, next) => {
  const store = d1Store({
    database: c.env.IDEMPOTENCY_DB,
    tableName: "idempotency_keys", // default
    ttl: 86400, // 24 hours in seconds (default)
  });
  return idempotency({ store })(c, next);
});
```

> **Note:** D1 provides strong consistency, making `lock()` reliable for concurrent request protection.

### Purging Expired Records

All stores expose a `purge()` method that physically removes expired records. This is especially important for D1, where expired rows are logically hidden but remain in storage.

```ts
// Cloudflare Workers: use waitUntil for non-blocking cleanup
app.post("/api/payments", async (c) => {
  c.executionCtx.waitUntil(store.purge());
  return c.json({ ok: true });
});

// Or use a Scheduled Worker for periodic cleanup
export default {
  async scheduled(event, env, ctx) {
    const store = d1Store({ database: env.IDEMPOTENCY_DB });
    ctx.waitUntil(store.purge());
  },
};
```

> **Note:** KV store's `purge()` is a no-op — KV handles expiration automatically via `expirationTtl`.

### Custom Store

Implement the `IdempotencyStore` interface:

```ts
import type { IdempotencyStore } from "hono-idempotency";

const customStore: IdempotencyStore = {
  async get(key) { /* ... */ },
  async lock(key, record) { /* return false if already locked */ },
  async complete(key, response) { /* ... */ },
  async delete(key) { /* ... */ },
  async purge() { /* return number of deleted records */ },
};
```

## Error Responses

All errors follow [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) with `Content-Type: application/problem+json`.

| Status | Code | Type | When |
|--------|------|------|------|
| 400 | `MISSING_KEY` | `/errors/missing-key` | `required: true` and no header |
| 400 | `KEY_TOO_LONG` | `/errors/key-too-long` | Key exceeds `maxKeyLength` |
| 409 | `CONFLICT` | `/errors/conflict` | Concurrent request with same key |
| 422 | `FINGERPRINT_MISMATCH` | `/errors/fingerprint-mismatch` | Same key, different request body |

## Accessing the Key in Handlers

The middleware sets `idempotencyKey` on the Hono context:

```ts
import type { IdempotencyEnv } from "hono-idempotency";

app.post("/api/payments", (c: Context<IdempotencyEnv>) => {
  const key = c.get("idempotencyKey");
  return c.json({ idempotencyKey: key });
});
```

## Documentation

- [Devin Wiki](https://app.devin.ai/org/ryota-ikezawa/wiki/paveg/hono-idempotency)

## License

MIT
