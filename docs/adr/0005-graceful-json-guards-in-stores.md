# 0005. Graceful JSON guards in serializing store adapters

## Status

Accepted (recorded retroactively)

## Context

Three adapters persist records as JSON strings (Redis, Cloudflare KV, D1), so
`JSON.stringify` can throw on write and `JSON.parse` can throw on corrupted
backend data. The other two (memory, Durable Objects) store structured objects
directly and have no JSON path. An uncaught throw inside a store call surfaces
as an opaque 500 from the middleware and could leave a key permanently locked.

## Decision

Serializing adapters degrade instead of throwing, and every degradation path
converges to "the request is processed again", which handlers must already
tolerate (see ADR 0001):

- `lock()` stringify failure → return `false` (Redis, KV; D1 binds SQL
  parameters and has no stringify step)
- `complete()` stringify failure → no-op, response served but not cached
  (Redis, KV, D1)
- `get()` parse failure on corrupt data → Redis returns `undefined` (a miss);
  D1 guards only the `response` column and returns the record with
  `response: undefined`

## Consequences

- For the guarded paths, a malformed record downgrades idempotency to
  re-execution rather than crashing the request; covered by dedicated tests in
  the Redis, KV, and D1 suites.
- The policy is intentionally uniform in outcome but not in mechanism — memory
  and Durable Objects need no guards because they never serialize.
- Known gaps (candidate hardening work, tracked outside this ADR): KV `get()`
  relies on the runtime's internal `type: "json"` parse, which throws on
  corrupt data; Durable Objects `complete()` does not guard `storage.put()`
  against a throwing write.
