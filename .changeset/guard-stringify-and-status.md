---
"hono-idempotency": minor
---

Guard JSON.stringify in all store adapters, add clampHttpStatus helper, validate Response status

- Wrap `JSON.stringify` in try/catch across redis, cloudflare-kv, cloudflare-d1 stores (lock returns false, complete is no-op on failure)
- Add `clampHttpStatus` helper (exported) to validate HTTP status codes (200-599, else 500)
- Apply status clamping in `problemResponse()` and `replayResponse()` to prevent RangeError
- `problemResponse()` falls back to 500 when JSON.stringify fails
- Enforce `maxBodySize` against actual body bytes, not just Content-Length header
- memoryStore FIFO eviction now skips processing records
- Redis and KV `complete()` preserves TTL from creation time
- KV `lock()` uses lockId for reliable read-back verification
- Delete corrupt completed records (no response) instead of returning 409
- Validate key byte length (UTF-8), guard JSON.parse in redis get(), lazy-delete expired DO records
- Update hono-problem-details to 0.1.4
