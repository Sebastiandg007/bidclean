# Properties Module Tests

Unit and integration tests for the properties module.

## Test Files

| File | Scope |
|------|-------|
| `properties.service.spec.ts` | CRUD operations, soft delete, ownership, pagination, idempotency |
| `properties.controller.spec.ts` | Endpoint routing, DTO validation, guard integration |
| `property-photo.service.spec.ts` | Upload, resize, encryption, transactional ordering, max count |
| `geocoding.service.spec.ts` | Forward/reverse geocoding, error handling, rate limiting |
| `property-owner.guard.spec.ts` | Ownership check, 403 on non-owner |

## Running Tests

```bash
# From services/api/
npm test -- --testPathPattern=properties
```
