---
"hono-idempotency": minor
---

Add multi-tenant safety warning. When `cacheKeyPrefix` is not configured and `methods` includes a state-mutating verb (POST/PATCH/PUT/DELETE), the middleware now emits a one-time `console.warn` at factory construction time pointing to the recommended fix.

Set the new `dangerouslyAllowGlobalKeys: true` option to acknowledge a single-tenant deployment and silence the warning. Existing behaviour is unchanged for users who already set `cacheKeyPrefix`.

Closes #126.
