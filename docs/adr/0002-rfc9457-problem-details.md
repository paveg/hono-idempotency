# 0002. RFC 9457 Problem Details for all middleware errors

## Status

Accepted (recorded retroactively)

## Context

The middleware rejects requests for several distinct reasons (missing key, key too
long, body too large, fingerprint mismatch, concurrent conflict). Clients need to
distinguish these programmatically; ad-hoc JSON error shapes force every consumer
to parse a bespoke format.

## Decision

All middleware-generated errors are RFC 9457 Problem Details
(`application/problem+json`) with a stable machine-readable `code` field
(`IdempotencyErrorCode`: `MISSING_KEY | KEY_TOO_LONG | BODY_TOO_LARGE |
FINGERPRINT_MISMATCH | CONFLICT`). `onError` lets applications override the
response while receiving the structured `ProblemDetail`.

## Consequences

- Consistent with the sibling middlewares (`hono-problem-details`, `hono-dpop`,
  `hono-webhook-verify`) — clients can share error-handling code across the family.
- The `code` enum is public API; adding a value is a minor change, renaming one is
  breaking.
- `clampHttpStatus` guards the status range (200-599, else 500) so a misbehaving
  store or handler cannot produce an invalid response status.
