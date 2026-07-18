# 0001. Cache only 2xx responses

## Status

Accepted (recorded retroactively)

## Context

When a handler fails (4xx/5xx) under an idempotency key, the middleware must decide
whether to replay that failure on retry or let the client try again.
Stripe's Idempotency-Key implementation caches error responses only in specific cases;
replaying transient errors (e.g. 503 from a downstream outage) would permanently
poison the key for its TTL.

## Decision

Only 2xx responses are stored via `complete()`. On a non-2xx response the lock record
is deleted, so the client can retry with the same key and reach the handler again.

## Consequences

- Transient failures are retryable without minting a new key — the primary use case
  for idempotency keys (payment retries) works out of the box.
- A deterministic 4xx (e.g. validation error) is re-executed on every retry; handlers
  must tolerate repeated invocation for error paths.
- Diverges from a strict reading of the IETF draft (which permits caching any final
  response), in favor of the widely deployed Stripe behavior.
