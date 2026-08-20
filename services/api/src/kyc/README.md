# KYC Module

## Purpose

Handles identity verification (Know Your Customer) for Cleaners. Orchestrates the KYC flow: document upload, selfie capture, AI-powered processing (OCR, face comparison, liveness detection), admin review, and secure data retention/cleanup. All document and selfie images are stored encrypted in MinIO with configurable auto-deletion.

## Files

| File | Responsibility |
|------|---------------|
| `kyc.module.ts` | NestJS module definition, wires providers and controllers |
| `kyc.controller.ts` | REST endpoints for document upload, selfie upload, status, retry |
| `kyc.service.ts` | Orchestrates KYC flow, coordinates sub-services |
| `kyc.types.ts` | Shared type definitions (KycStatus, interfaces, config) |
| `state-machine/kyc-state-machine.ts` | Enforces valid state transitions for the KYC flow |
| `state-machine/kyc-state-transition.service.ts` | Atomic state transitions with pessimistic locking |
| `state-machine/kyc-state-machine.types.ts` | Type definitions for transitions, guards, and context |
| `state-machine/kyc-state-machine.errors.ts` | Custom HTTP exceptions for state machine errors |
| `ai-client/ai-client.service.ts` | HTTP client for FastAPI AI service (OCR, face compare, liveness) with retries and error handling |
| `ai-client/ai-client.types.ts` | Request/response types for AI service communication |
| `ai-client/ai-client.errors.ts` | Custom error classes for AI service failures (timeout, network, HTTP) |
| `storage/kyc-storage.service.ts` | MinIO client for encrypted image storage (upload, download, delete, key generation) |
| `storage/kyc-storage.types.ts` | Storage operation interfaces (upload/download/delete options and results) |
| `admin/kyc-admin.controller.ts` | Admin endpoints for review queue and decisions |
| `admin/kyc-admin.service.ts` | Admin business logic (queue, detail, approve/reject) |
| `jobs/kyc-process.job.ts` | BullMQ processor for async AI processing pipeline (OCR → liveness → face compare → evaluate → notify) |
| `jobs/kyc-cleanup.job.ts` | Scheduled cron job (daily 3 AM) for automatic image deletion after retention period |
| `dto/upload-document.dto.ts` | Validation for document upload requests |
| `dto/upload-selfie.dto.ts` | Validation for selfie upload requests |
| `dto/admin-decision.dto.ts` | Validation for admin approve/reject decisions |
| `entities/kyc-verification.entity.ts` | TypeORM entity for kyc_verifications table |
| `entities/kyc-audit-log.entity.ts` | TypeORM entity for kyc_audit_logs table |
| `__tests__/kyc.service.spec.ts` | Unit tests for document upload flow |
| `__tests__/kyc-status.spec.ts` | Unit tests for KYC status endpoint |
| `__tests__/kyc-selfie-upload.spec.ts` | Unit tests for selfie upload flow |
| `__tests__/kyc-state-machine.spec.ts` | Unit tests for state machine logic |
| `__tests__/kyc-state-transition.service.spec.ts` | Unit tests for atomic state transitions |
| `__tests__/kyc-storage.service.spec.ts` | Unit tests for MinIO storage operations |
| `__tests__/kyc-admin.service.spec.ts` | Unit tests for admin service |
| `__tests__/kyc-retry.spec.ts` | Unit tests for KYC retry logic |
| `__tests__/ai-client.service.spec.ts` | Unit tests for AI client service (HTTP calls, retries, error handling) |
| `__tests__/kyc-process.job.spec.ts` | Unit tests for KYC processing job (pipeline, thresholds, retries, name matching) |
| `__tests__/kyc-cleanup.job.spec.ts` | Unit tests for KYC cleanup job (batch deletion, audit logging, error handling) |

## Dependencies

- **Auth Module** — JWT guard for endpoint protection, User entity reference
- **Roles Module** — Cleaner role validation
- **FastAPI AI Service** — OCR, face comparison, liveness detection
- **MinIO** — Encrypted object storage for documents and selfies
- **BullMQ** — Async job processing and scheduling
- **OneSignal** — Push notifications for verification results
- **PostgreSQL** — Persistent storage for verification records and audit logs

## API

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/kyc/document` | Upload identity document image | Access token (Cleaner) |
| POST | `/kyc/selfie` | Upload selfie, enqueue processing | Access token (Cleaner) |
| GET | `/kyc/status` | Get current verification status | Access token (Cleaner) |
| POST | `/kyc/retry` | Start a new verification attempt | Access token (Cleaner) |
| GET | `/admin/kyc/queue` | Get pending verifications for review | Admin token |
| GET | `/admin/kyc/:id` | Get full verification details | Admin token |
| POST | `/admin/kyc/:id/decision` | Approve or reject verification | Admin token |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `KYC_AI_SERVICE_URL` | FastAPI AI service base URL | Yes |
| `AI_SERVICE_AUTH_TOKEN` | Bearer token for AI service authentication | Yes |
| `MINIO_ENDPOINT` | MinIO server endpoint | Yes |
| `MINIO_ROOT_USER` | MinIO access key | Yes |
| `MINIO_ROOT_PASSWORD` | MinIO secret key | Yes |
| `KYC_MINIO_BUCKET` | MinIO bucket name for KYC images | Yes |
| `KYC_MAX_ATTEMPTS` | Maximum verification attempts per user | Yes |
| `KYC_MAX_FILE_SIZE_MB` | Maximum file size for uploads (MB) | Yes |
| `KYC_RETENTION_DAYS` | Days to retain images before auto-deletion | Yes |
| `KYC_PROCESSING_MAX_RETRIES` | Max retries for processing job | Yes |
| `KYC_PROCESSING_BACKOFF_MS` | Backoff interval (ms) between retries | Yes |
| `KYC_PROCESSING_TIMEOUT_MS` | Request timeout (ms) for AI service calls | Yes |
| `KYC_OCR_CONFIDENCE_MIN` | Minimum OCR confidence threshold | Yes |
| `KYC_FACE_SIMILARITY_MIN` | Minimum face similarity threshold | Yes |
| `KYC_LIVENESS_SCORE_MIN` | Minimum liveness score threshold | Yes |
| `KYC_NAME_MATCH_MIN` | Minimum name match score threshold | Yes |

## State Machine

```
NOT_STARTED → DOCUMENT_UPLOADED → SELFIE_UPLOADED → PROCESSING → VERIFIED
                                                              └→ REJECTED
```

- States can only move forward (no backwards transitions)
- Terminal states: VERIFIED, REJECTED
- Retry creates a new attempt record (does not modify previous attempts)

## Processing Pipeline

The `KycProcessJob` implements the async AI verification pipeline:

```
SELFIE_UPLOADED → PROCESSING → [AI Pipeline] → VERIFIED / REJECTED
```

### Pipeline Steps
1. Transition state to PROCESSING
2. OCR extraction (short-circuit on deterministic failure)
3. Liveness detection (short-circuit on deterministic failure)
4. Face comparison (short-circuit on deterministic failure)
5. Name match calculation (Levenshtein similarity)
6. Evaluate all scores against configured thresholds
7. Transition to VERIFIED or REJECTED
8. Send push notification via OneSignal

### Error Handling
- **Deterministic failures** (AI returns 4xx): Immediately reject with reason
- **Transient failures** (5xx, network, timeout): Throw to let BullMQ retry
- **Max retries exhausted**: Reject with admin review escalation reason

## Retry Endpoint

`POST /kyc/retry` allows a Cleaner whose verification was REJECTED to start a new attempt.

### Preconditions
- User must have `cleaner` role
- Latest verification must be in `REJECTED` status
- `attemptNumber` must be less than `KYC_MAX_ATTEMPTS` (env variable)

### Behavior
- Creates a NEW `kyc_verifications` record with `attemptNumber = previous + 1`
- New record starts in `NOT_STARTED` status
- Previous attempt record is preserved (immutable once completed)
- Creates an audit log entry for the retry

### Error Responses
| Condition | HTTP Status | Error Key |
|-----------|-------------|-----------|
| Not a Cleaner | 403 | `kyc.error.not_cleaner` |
| Already verified | 409 | `kyc.error.already_verified` |
| Status not REJECTED | 409 | `kyc.error.not_rejected` |
| Max attempts reached | 429 | `kyc.error.max_attempts` |

## Cleanup Job

`KycCleanupJob` runs as a scheduled cron job (daily at 3:00 AM) to delete expired document and selfie images from MinIO after the configurable retention period (`KYC_RETENTION_DAYS`).

### Behavior
- Queries verifications where `completedAt` (or `createdAt` if not completed) is older than retention days AND at least one storage key is present
- Processes deletions in batches of 50 to avoid overwhelming MinIO
- Each deletion is independent — if one fails, continues with others
- After successful MinIO deletion, clears the storage key from the entity
- Creates audit log entries with actions `DOCUMENT_DELETED` or `SELFIE_DELETED`
- `actorId` is null (system-triggered action)
- Deletion is idempotent — if object already deleted from MinIO, job succeeds without error

### Audit Metadata
```json
{
  "triggeredBy": "kyc-cleanup-job",
  "storageKey": "kyc/{userId}/{category}/{uuid}.{ext}",
  "retentionDays": 90
}
```
