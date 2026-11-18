# Shared Source (`packages/shared/src`)

## Purpose

Source of `@bidclean/shared`. `index.ts` is the single entry point and re-exports the three sub-folders, so consumers import from `@bidclean/shared` only.

## Files

| File / Folder | Responsibility |
|---------------|---------------|
| `index.ts` | Re-exports `./types`, `./constants` and `./outbox/outbox-writer`. |
| [`constants/`](constants/README.md) | Business and time constants. |
| [`outbox/`](outbox/README.md) | Domain-agnostic transactional outbox writer. |
| [`types/`](types/README.md) | Shared domain types (users, offers, payments, notifications). |

## Dependencies

- None at runtime. The API keeps a parity copy of the outbox writer in `services/api/src/common` because it compiles with `rootDir: ./src`.
