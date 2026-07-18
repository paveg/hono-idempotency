---
"hono-idempotency": patch
---

Harden store adapters against corrupt data and failing writes: `kvStore` now treats corrupt JSON in KV as a cache miss instead of throwing (`get`/`lock`/`complete` and the lock read-back), and `durableObjectStore.complete()` no longer propagates a `storage.put()` failure — the response is served uncached so the client can retry with the same key.
