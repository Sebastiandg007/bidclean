# KYC State Machine

## Purpose

Manages KYC verification state transitions with guards, atomic database updates, and idempotency. Ensures the verification flow progresses only through valid paths and prevents race conditions from concurrent requests.

## Files

| File | Responsibility |
|------|---------------|
| `kyc-state-machine.ts` | Pure state machine logic: valid transitions, guards, metadata generation |
| `kyc-state-transition.service.ts` | NestJS service wrapping the state machine with atomic DB operations |
| `kyc-state-machine.errors.ts` | Custom error classes for state transition failures |
| `kyc-state-machine.types.ts` | TypeScript interfaces for transition context, guards, results |
| `index.ts` | Barrel exports for the module |

## State Flow

```
NOT_STARTED → DOCUMENT_UPLOADED → SELFIE_UPLOADED → PROCESSING → VERIFIED
                                                                → REJECTED
```

- Terminal states: `VERIFIED`, `REJECTED` (no transitions out)
- Retries create a **new attempt record** — never transition backwards

## Guards

Each transition has precondition checks that must pass:

| Target Status | Guards |
|---------------|--------|
| `DOCUMENT_UPLOADED` | Document storage key must be provided |
| `SELFIE_UPLOADED` | Selfie storage key provided + document must already exist |
| `PROCESSING` | Selfie must already exist on the verification |
| `REJECTED` | Rejection reason must be provided |
| `VERIFIED` | No additional guards |

## Atomic Updates

The `KycStateTransitionService` uses:

1. **SELECT ... FOR UPDATE** — Pessimistic row-level lock to prevent concurrent reads
2. **UPDATE ... WHERE status = :expectedStatus** — Optimistic check ensuring no concurrent modification happened between read and write
3. **Transaction wrapping** — All operations within a single database transaction

## Idempotency

If the verification is already in the target state (e.g., mobile retry after timeout), the service returns success without modifying the database. This prevents duplicate state changes from network retries.

## Dependencies

- TypeORM (EntityManager, Repository)
- `@nestjs/common` (Injectable, Logger, HttpException)
- `KycVerification` entity

## Environment Variables

None directly — this module is configuration-free. Business limits (max attempts) are enforced by callers using `MaxAttemptsExceededError`.
