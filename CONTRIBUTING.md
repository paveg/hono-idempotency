# Contributing to hono-idempotency

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/paveg/hono-idempotency.git
cd hono-idempotency
pnpm install
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm test` | Run tests (vitest) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm build` | Build ESM + CJS (tsup) |
| `pnpm lint` | Check linting (Biome) |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm format` | Format code |
| `pnpm typecheck` | Type check (tsc --noEmit) |

## Workflow

1. Fork the repository and create a branch from `main`.
2. Write tests first, then implement your changes (TDD).
3. Run `pnpm test` and `pnpm typecheck` to verify.
4. Run `pnpm lint` — a pre-commit hook runs Biome automatically.
5. Open a pull request against `main`.

## Code Style

- **Formatter/Linter**: Biome (tabs, double quotes, semicolons, 100-char line width)
- **Tests**: vitest with 100% coverage target (v8 provider)
- **Comments**: English only; write "why", not "what"

## Adding a Store Adapter

Store adapters implement the `IdempotencyStore` interface (`get`, `lock`, `complete`, `delete`, `purge`). If you want to add a new store:

1. Create `src/stores/<name>.ts` implementing the interface.
2. Add tests in `tests/stores/<name>.test.ts`.
3. Export from `package.json` `exports` field.
4. Document the store in `README.md`.

## Commit Messages

Keep commit messages concise and descriptive. Use [Changesets](https://github.com/changesets/changesets) for versioning:

```bash
pnpm changeset
```

## Reporting Issues

Use [GitHub Issues](https://github.com/paveg/hono-idempotency/issues). For security vulnerabilities, see [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
