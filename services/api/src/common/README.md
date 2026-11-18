# Common

## Purpose

API-local, domain-agnostic infrastructure shared by several feature modules. It currently holds a copy of the transactional outbox writer. The copy exists because the API compiles with `rootDir: ./src` and cannot pull `@bidclean/shared` sources into its program; it must stay in parity with `packages/shared/src/outbox/outbox-writer.ts`, which remains the canonical contract.

## Files

| File | Responsibility |
|------|---------------|
| `outbox/outbox-writer.ts` | `writeOutbox(tx, row)` inserts one row into a caller-named outbox table inside the caller's transaction. Exports `OutboxQueryExecutor` and `OutboxRow`. Carries no domain semantics. |

## Dependencies

- None at runtime. Callers pass a TypeORM `EntityManager` or `QueryRunner` (anything with a parameterized `query`).
- Mirrors [`packages/shared/src/outbox`](../../../../packages/shared/src/outbox/README.md).
