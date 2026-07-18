# 0004. Request fingerprint via SHA-256 over Web Crypto

## Status

Accepted (recorded retroactively)

## Context

The IETF draft requires detecting key reuse with a different payload
(fingerprint mismatch). The hash must run identically on Node, Cloudflare
Workers, Deno, and Bun; pulling in `node:crypto` or a hashing dependency would
break edge runtimes or add supply-chain surface.

## Decision

The default fingerprint is a SHA-256 digest of `` `${method}:${path}:${body}` `` computed
with the Web Crypto API (`crypto.subtle.digest`), available natively in every
target runtime. A `fingerprint(c)` option allows replacing it (e.g. to include
tenant headers or ignore volatile body fields).

## Consequences

- Zero runtime dependencies and identical behavior across runtimes.
- The body is read via `c.req.text()` (Hono caches it, so the handler can still
  consume it); `maxBodySize` bounds the memory cost of buffering it.
- Fingerprinting is per method+path by construction, matching the store key
  format `${prefix}:${method}:${path}:${key}`.
