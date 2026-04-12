---
"hono-idempotency": patch
---

### Security

- Use constant-time XOR comparison for fingerprint matching to prevent timing side-channel attacks
- Exclude `content-length` and `transfer-encoding` from stored response headers to prevent HTTP framing mismatches on replay
- Use `Number.isInteger()` in `clampHttpStatus` to reject non-integer status codes
- Add `charset=utf-8` to `application/problem+json` Content-Type per RFC 9457 §6.1
- Clarify `maxBodySize` scope in JSDoc (only applies when Idempotency-Key header is present)

### Performance

- Defer request body consumption until after `store.get()` so 409 Conflict returns without reading the body
- Throttle memory store sweep to interval-based execution (`sweepInterval` option, default 60s) instead of per-`lock()` full Map scan
