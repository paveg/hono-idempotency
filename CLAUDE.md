# CLAUDE.md

## Project

Stripe-style Idempotency-Key middleware for Hono. IETF draft-ietf-httpapi-idempotency-key-header compliant.

## Commands

- `pnpm test` — Run tests (vitest)
- `pnpm build` — Build ESM + CJS (tsup)
- `pnpm lint` — Check linting (biome)
- `pnpm lint:fix` — Auto-fix lint issues
- `pnpm format` — Format code
- `pnpm typecheck` — Type check (tsc --noEmit)

## Architecture

- `src/middleware.ts` — Core middleware (method filter, key validation, fingerprint, lock/complete/delete flow)
- `src/stores/` — Store adapters (`memory.ts` is production-ready, `cloudflare-kv.ts` and `cloudflare-d1.ts` are stubs)
- `src/errors.ts` — RFC 9457 Problem Details responses
- `src/fingerprint.ts` — SHA-256 fingerprint via Web Crypto API
- `src/types.ts` — Core type definitions
- Store key format: `${method}:${path}:${key}` (namespaced to prevent cross-endpoint collisions)

## Conventions

- Package manager: pnpm
- Formatter/linter: Biome (tabs, double quotes, semicolons always, line width 100)
- Pre-commit hook: lefthook runs `biome check` on staged files
- Tests: vitest with v8 coverage (100% coverage target)
- TDD: write tests first, then implementation
- Error responses: RFC 9457 `application/problem+json`
- Non-2xx responses are NOT cached (Stripe pattern — allows client retry)
