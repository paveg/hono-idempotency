---
title: "Stop Double-Charging Users: Idempotency Middleware for Hono"
published: false
tags: hono, typescript, cloudflare, webdev
# cover_image: (TODO: OGP image)
---

A user taps "Pay" on their phone. The request times out. They tap again. Your server happily processes both — and charges them twice.

This isn't a hypothetical. Mobile retries, load balancer re-sends, impatient double-clicks — any of these can trigger duplicate POST requests. Stripe solved this years ago with the `Idempotency-Key` header: send the same key twice, get the same response without re-executing the handler.

Hono didn't have this. So I built it.

## Quick Start

```bash
npm install hono-idempotency
```

```ts
import { Hono } from "hono";
import { idempotency } from "hono-idempotency";
import { memoryStore } from "hono-idempotency/stores/memory";

const app = new Hono();
app.use("/api/*", idempotency({ store: memoryStore() }));

app.post("/api/payments", (c) => {
  // Runs once per unique Idempotency-Key.
  // Retries return the cached response.
  return c.json({ id: "pay_123", status: "succeeded" }, 201);
});
```

The second request with the same key skips the handler entirely and returns the cached response with an `Idempotency-Replayed: true` header.

```bash
# First request — handler executes
curl -X POST http://localhost:3000/api/payments \
  -H "Idempotency-Key: abc-123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000}'
# => 201 {"id":"pay_123","status":"succeeded"}

# Second request — cached response
curl -X POST http://localhost:3000/api/payments \
  -H "Idempotency-Key: abc-123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000}'
# => 201 {"id":"pay_123","status":"succeeded"}
# (Idempotency-Replayed: true)
```

## Why Not Just Write It Yourself (or Ask AI)?

You could ask an LLM to generate idempotency middleware, or write it from scratch. You'd get something functional quickly. But in application development, there's no reason to reinvent the wheel when a reliable, transparent solution already exists.

A well-tested library with full source code, 100% test coverage, and an open commit history gives you something that one-off code doesn't: **confidence that edge cases have been found and fixed.** Here are some that are easy to miss:

### Set-Cookie leaks across users

When replaying a cached response, you must exclude `Set-Cookie` headers. Otherwise, User B retrying with the same key gets User A's session cookie — a security vulnerability that only surfaces in multi-user replay scenarios.

### Non-2xx responses must not be cached

If a payment fails with a 500, should the client get 500 forever? Following Stripe's pattern, the key is deleted on non-2xx so the client can retry. Caching failures locks users out of recovery.

### Key injection via delimiters

Store keys use `:` as a delimiter: `POST:/api/payments:user-key-123`. A malicious key like `evil:POST:/api/admin` could collide with other routes or tenants. `encodeURIComponent` prevents this — a subtle attack vector that rarely shows up in generated or hand-written code.

### Hook error isolation

Observability hooks (`onCacheHit` / `onCacheMiss`) should never break idempotency guarantees. The middleware wraps all hooks in a `safeHook()` that swallows errors — hooks are for observability, not control flow.

### Optimistic locking per store

Concurrent requests with the same key must not both acquire the lock. Redis needs `SET NX EX`, D1 needs `INSERT OR IGNORE`, Durable Objects use single-writer guarantees. Each store has different atomicity primitives, and getting them wrong means duplicate processing — the exact problem you're trying to solve.

That said, this isn't a blanket "always use OSS" argument. Libraries can have slow release cycles, unresponsive maintainers, or stale issues. And the rise of AI-generated "slop" — low-quality issues and PRs flooding repositories — has added a new burden on maintainers, making it harder to distinguish signal from noise. How to build reliable software in this landscape is still an open question.

What I can say is: when a library is actively maintained, has transparent source code and high test coverage, and solves a problem with non-obvious edge cases — using it beats reinventing it. Unless your environment prohibits external dependencies (some FDE roles or regulated contexts), **64 commits worth of edge-case fixes are a better starting point than a blank file.**

## Design Decisions

### Why not cache failed responses?

The IETF draft doesn't specify this, but Stripe's implementation is clear: non-2xx responses are not cached. If a payment fails due to a transient error (database timeout, third-party API flake), the client should be able to retry with the same key and get a fresh attempt. Caching failures would force clients to generate new keys for every retry — defeating the purpose of idempotency.

### Request fingerprinting prevents misuse

Same key + different request body = `422 Fingerprint Mismatch`. Without this, a client could accidentally (or maliciously) reuse a key for a completely different operation. The default fingerprint is SHA-256 of `method + path + body` using the Web Crypto API — available on every runtime Hono supports.

### Why client-generated keys?

Server-generated idempotency keys can't distinguish between "retry the same payment" and "make a second payment for the same amount." Only the client knows whether it's retrying or making a new request. That's why Stripe, the IETF draft, and this middleware all use client-provided keys.

### RFC 9457 error responses

Every error returns `application/problem+json` with a machine-readable `code` field:

| Code | Status | Meaning |
|------|--------|---------|
| `MISSING_KEY` | 400 | `required: true` and no header sent |
| `KEY_TOO_LONG` | 400 | Exceeds `maxKeyLength` (default 256) |
| `CONFLICT` | 409 | Another request is still processing |
| `FINGERPRINT_MISMATCH` | 422 | Same key, different body |

## Production-Ready Stores

Start with `memoryStore()` for development. Pick your production store based on your runtime:

| Store | Best for | Lock atomicity | TTL |
|-------|----------|----------------|-----|
| **Memory** | Dev / single-instance | In-process Map | Sweep on access |
| **Redis** | Node.js / serverless | `SET NX EX` (strongest) | Automatic |
| **Cloudflare KV** | Multi-region, low contention | Eventual (not atomic) | Automatic |
| **Cloudflare D1** | Multi-region, strong consistency | `INSERT OR IGNORE` | SQL filter |
| **Durable Objects** | Cloudflare, strong consistency | Single-writer | Manual |

The Redis store works with ioredis, node-redis, and @upstash/redis. For Cloudflare Workers, Durable Objects gives you the strongest guarantees; KV is simpler but eventually consistent.

## Pairs Well With

If you're receiving webhooks, pair `hono-idempotency` with [hono-webhook-verify](https://github.com/paveg/hono-webhook-verify) for signature verification:

```
Webhook received → Verify signature → Idempotently process
```

Webhook providers often retry on timeout. Without idempotency, you'd process the same event multiple times. With both middlewares, you get verified-and-deduplicated webhook handling.

## Get Started

<!-- TODO: Uncomment after honojs/website#824 is merged -->
<!-- > hono-idempotency is listed as an official [Hono third-party middleware](https://hono.dev/docs/middleware/third-party). -->

- **npm:** [hono-idempotency](https://www.npmjs.com/package/hono-idempotency)
- **GitHub:** [paveg/hono-idempotency](https://github.com/paveg/hono-idempotency)
- **IETF draft:** [draft-ietf-httpapi-idempotency-key-header](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- **Deep dive (Japanese):** [Honoの冪等性ミドルウェアを作った](https://www.funailog.com/blog/2026/hono-idempotency-middleware/) — design philosophy and architecture details

Stars, issues, and PRs are welcome. If you're using it in production, I'd love to hear about it.
