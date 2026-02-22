---
"hono-idempotency": minor
---

Add Redis store adapter (`redisStore`) and Durable Objects store adapter (`durableObjectStore`)

- **Redis**: Atomic locking via `SET NX EX`, compatible with ioredis, node-redis, and @upstash/redis
- **Durable Objects**: Leverages DO single-writer model for guaranteed lock atomicity
- Add Typed RPC Client documentation for `IdempotencyEnv` with `hc<AppType>`
