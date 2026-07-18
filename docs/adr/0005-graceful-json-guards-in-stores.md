# 0005. Graceful JSON guards in all store adapters

## Status

Accepted (recorded retroactively)

## Context

Store adapters serialize records with `JSON.stringify` and deserialize with
`JSON.parse`. Both can throw: non-serializable response metadata on write,
corrupted or concurrently-mutated backend data on read. An uncaught throw inside
a store call would surface as an opaque 500 from the middleware and could leave a
key permanently locked.

## Decision

Every adapter guards both directions with a uniform degradation policy:

- `lock()` serialization failure → return `false` (caller sees a lock conflict,
  request is not processed unprotected)
- `complete()` serialization failure → no-op (response is returned to the client
  but not cached; a retry re-executes the handler)
- `get()` parse failure on corrupt data → return `undefined` (treated as a miss)

## Consequences

- A malformed record can never crash the request path; the worst case is losing
  idempotency for that key, never a stuck lock or a 500.
- Failures are silent by design — acceptable because every degradation path
  converges to "process the request again", which handlers must already tolerate.
- All five adapters implement the same policy, verified by dedicated tests.
