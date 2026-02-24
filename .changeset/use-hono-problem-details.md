---
"hono-idempotency": minor
---

Add hono-problem-details as optional peerDependency with runtime fallback

- Declare `hono-problem-details` as optional peerDependency
- When installed: error responses use `problemDetails().getResponse()` from hono-problem-details
- When not installed: falls back to existing self-contained implementation
- Detection is lazy (first error path only) — no overhead on happy path
- Public API (`problemResponse`, `ProblemDetail`, `IdempotencyErrors`) unchanged
