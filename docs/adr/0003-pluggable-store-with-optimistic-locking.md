# 0003. Pluggable store interface with optimistic locking

## Status

Accepted (recorded retroactively)

## Context

Idempotency state must survive across concurrent requests and, depending on the
deployment, across processes and regions. Node servers, Cloudflare Workers, and
Durable Objects have very different storage primitives with different atomicity
guarantees.

## Decision

Storage is abstracted behind the `IdempotencyStore` interface
(`get / lock / complete / delete / purge`). `lock()` returns a boolean and is the
single concurrency-control point: the first caller to acquire the lock processes
the request, later callers observe `processing` and receive `409 CONFLICT`.
Adapters implement the strongest atomicity their backend offers (Redis `SET NX EX`,
D1 conditional insert, DO single-writer; KV is best-effort with `lockId` read-back).

## Consequences

- Five production adapters ship in-tree; custom backends only need five methods.
- Consistency is only as strong as the backend — the README documents per-store
  guarantees so users can match the store to their correctness requirements.
- `purge()` is allowed to be a no-op (returns 0) where the backend expires keys
  natively (Redis, KV), keeping the interface uniform without forcing busywork.
