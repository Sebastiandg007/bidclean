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
| `ai-client/ai-client.service.ts` | HTTP client for FastAPI AI service (OCR, face compare, liveness) |
| `ai-client/ai-client.types.ts` | Request/response types for AI service communication |
| `storage/kyc-storage.service.ts` | MinIO client for encrypted image storage (upload, download, delete, key generation) |
| `storage/kyc-storage.types.ts` | Storage operation interfaces (upload/download/delete options and results) |
| `admin/kyc-admin.controller.ts` | Admin endpoints for review queue and decisions |
| `admin/kyc-admin.service.ts` | Admin business logic (queue, detail, approve/reject) |
| `jobs/kyc-process.job.ts` | BullMQ job for async AI processing pipeline |
| `jobs/kyc-cleanup.job.ts` | Scheduled job for image retention/deletion |
| `dto/upload-document.dto.ts` | Validation for document upload requests |
| `dto/upload-selfie.dto.ts` | Validation for selfie upload requests |
| `dto/admin-decision.dto.ts` | Validation for admin approve/reject decisions |
| `entities/kyc-verification.entity.ts` | TypeORM entity for kyc_verifications table |
| `entities/kyc-audit-log.entity.ts` | TypeORM entity for kyc_audit_logs table |

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
| `AI_SERVICE_URL` | FastAPI AI service base URL | Yes |
| `AI_SERVICE_AUTH_TOKEN` | Bearer token for AI service authentication | Yes |
| `MINIO_ENDPOINT` | MinIO server endpoint | Yes |
| `MINIO_ROOT_USER` | MinIO access key | Yes |
| `MINIO_ROOT_PASSWORD` | MinIO secret key | Yes |
| `KYC_MINIO_BUCKET` | MinIO bucket name for KYC images | Yes |
| `KYC_MAX_ATTEMPTS` | Maximum verification attempts per user | Yes |
| `KYC_MAX_FILE_SIZE_MB` | Maximum file size for uploads (MB) | Yes |
| `KYC_IMAGE_RETENTION_DAYS` | Days to retain images before auto-deletion | Yes |
| `KYC_PROCESSING_MAX_RETRIES` | Max retries for processing job | Yes |
| `KYC_PROCESSING_BACKOFF_MS` | Backoff interval (ms) between retries | Yes |
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
