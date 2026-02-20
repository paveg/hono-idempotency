# CLAUDE.md

## Project

Stripe-style Idempotency-Key middleware for Hono (v0.5.0). IETF draft-ietf-httpapi-idempotency-key-header compliant.

## Commands

- `pnpm test` — Run tests (vitest, 90 tests across 5 files)
- `pnpm build` — Build ESM + CJS (tsup)
- `pnpm lint` — Check linting (biome)
- `pnpm lint:fix` — Auto-fix lint issues
- `pnpm format` — Format code
- `pnpm typecheck` — Type check (tsc --noEmit)
- `pnpm release` — Build + changeset publish

## Architecture

- `src/middleware.ts` — Core middleware (method filter, skipRequest, key validation, fingerprint, cacheKeyPrefix, lock/complete/delete flow, onError)
- `src/stores/` — Store adapters (all production-ready: `memory.ts`, `cloudflare-kv.ts`, `cloudflare-d1.ts`)
- `src/stores/types.ts` — `IdempotencyStore` interface (`get/lock/complete/delete/purge`)
- `src/errors.ts` — RFC 9457 Problem Details with `IdempotencyErrorCode` (`MISSING_KEY | KEY_TOO_LONG | FINGERPRINT_MISMATCH | CONFLICT`)
- `src/fingerprint.ts` — SHA-256 fingerprint via Web Crypto API
- `src/types.ts` — `IdempotencyOptions`, `IdempotencyEnv`, `IdempotencyRecord`, `StoredResponse`
- Store key format: `${encodeURIComponent(prefix)}:${method}:${path}:${encodeURIComponent(key)}` (prefix omitted when not set)

### Middleware options

| Option | Type | Description |
|--------|------|-------------|
| `store` | `IdempotencyStore` | Required. Storage backend |
| `headerName` | `string` | Header name (default: `Idempotency-Key`) |
| `fingerprint` | `(c: Context) => string \| Promise<string>` | Custom fingerprint (default: SHA-256 of method+path+body) |
| `required` | `boolean` | Require key on all requests (default: `false`) |
| `methods` | `string[]` | HTTP methods to apply (default: `["POST", "PATCH"]`) |
| `maxKeyLength` | `number` | Max key length (default: 256) |
| `skipRequest` | `(c: Context) => boolean \| Promise<boolean>` | Per-request opt-out |
| `onError` | `(error: ProblemDetail, c: Context) => Response \| Promise<Response>` | Custom error response |
| `cacheKeyPrefix` | `string \| ((c: Context) => string \| Promise<string>)` | Multi-tenant key prefix |

### Store implementations

| Store | TTL | `purge()` | Notes |
|-------|-----|-----------|-------|
| `memoryStore` | In-process sweep on `lock()` + `get()` | Sweeps expired entries, returns count | `maxSize` for FIFO eviction |
| `kvStore` | KV `expirationTtl` (automatic) | No-op, returns 0 | Cloudflare KV handles expiry |
| `d1Store` | SQL `WHERE created_at < ?` filter | `DELETE WHERE created_at < ?`, returns count | Table name regex-validated |

## Conventions

- Package manager: pnpm (not npm)
- Formatter/linter: Biome (tabs, double quotes, semicolons always, line width 100)
- Pre-commit hook: lefthook runs `biome check` on staged files
- Tests: vitest with v8 coverage (100% coverage target)
- TDD: write tests first, then implementation
- Error responses: RFC 9457 `application/problem+json` with `code` field
- Non-2xx responses are NOT cached (Stripe pattern — allows client retry)
- Versioning: changesets (`pnpm changeset`)
- GitHub comments and code comments in English
- Security review before creating PRs
