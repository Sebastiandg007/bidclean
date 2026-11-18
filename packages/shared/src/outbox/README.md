# Outbox

## Purpose

Canonical, domain-agnostic transactional outbox writer. A bounded context calls `writeOutbox` inside the same transaction as the business fact, so the event is atomic with the fact. The notifications relay later drains the rows. The writer holds no domain semantics: the caller owns the table name, `eventId` and payload. The table name is validated as a bare SQL identifier and values are bound parameters.

## Files

| File | Responsibility |
|------|---------------|
| `outbox-writer.ts` | Exports `OutboxQueryExecutor`, `OutboxRow` and `writeOutbox(tx, row)`. `version` defaults to 1. |

## Dependencies

- None. Parity copy: `services/api/src/common/outbox/outbox-writer.ts`; keep both in sync.
