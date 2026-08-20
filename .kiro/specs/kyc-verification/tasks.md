# Implementation Plan

## Overview

Implementation tasks for the KYC Verification feature. Covers the NestJS backend module (state management, orchestration, storage, admin), the Python FastAPI AI service (OCR, face comparison, liveness detection), and the React Native/Expo mobile screens (document capture, selfie capture, status display).

## Tasks

- [x] 1. Create KYC module structure in NestJS (module, controller, service, types, DTOs, entities, state-machine/, ai-client/, storage/, admin/, jobs/, tests folder, README)
- [x] 2. Create database migration for kyc_verifications table (with UNIQUE and CHECK constraints, idx_kyc_user_attempt index), kyc_audit_logs table. No kyc_status column on users — status is derived from latest attempt.
- [x] 3. Add KYC environment variables to .env.example (thresholds, retention, MinIO bucket, AI service URL, AI_SERVICE_AUTH_TOKEN, rate limits, KYC_PROCESSING_MAX_RETRIES, KYC_PROCESSING_BACKOFF_MS)
- [x] 4. Implement KYC state machine (valid transitions, guards, atomic updates, idempotency checks)
- [x] 5. Implement KYC storage service (MinIO upload with encryption, download, delete, key generation)
- [x] 6. Implement upload document endpoint (POST /kyc/document — validate file, store in MinIO, transition state to DOCUMENT_UPLOADED, accept Idempotency-Key header)
- [x] 7. Implement upload selfie endpoint (POST /kyc/selfie — validate file, store in MinIO, transition state to SELFIE_UPLOADED, enqueue BullMQ processing job, accept Idempotency-Key header)
- [ ] 8. Implement KYC status endpoint (GET /kyc/status — return current verification state, attempt number, rejection reason)
- [ ] 9. Implement KYC retry endpoint (POST /kyc/retry — create new attempt, validate max retries not exceeded, preserve previous attempt)
- [ ] 10. Implement AI client service (HTTP client for internal FastAPI calls — OCR, face-compare, liveness endpoints with error handling and retries)
- [ ] 11. Implement KYC processing job (BullMQ job with configurable retries and exponential backoff, calls AI service pipeline: OCR → liveness → face-compare with short-circuit on deterministic failures → evaluate thresholds → update state. After max retries, enters admin review.)
- [ ] 12. Implement KYC cleanup job (BullMQ scheduled job that deletes expired document images from MinIO based on configurable retention period. Deletion is idempotent — if object already deleted, job succeeds without error.)
- [ ] 13. Implement admin review queue endpoint (GET /admin/kyc/queue — list pending/rejected verifications sorted by age)
- [ ] 14. Implement admin decision endpoint (POST /admin/kyc/:id/decision — approve or reject with reason, update state, log audit)
- [ ] 15. Implement KYC audit logging (log all state transitions, admin actions, and data access to kyc_audit_logs. Actions: DOCUMENT_VIEWED, SELFIE_VIEWED, OCR_VIEWED, VERIFICATION_APPROVED, VERIFICATION_REJECTED, DOCUMENT_DELETED, SELFIE_DELETED. Admin image access logged for GDPR compliance.)
- [ ] 16. Implement offer acceptance guard (middleware that checks latest kyc_verifications record status === VERIFIED before allowing offer acceptance — status derived from latest attempt, not a column on users)
- [ ] 17. Implement push notification on KYC status change (OneSignal integration for VERIFIED and REJECTED events)
- [ ] 18. Create FastAPI KYC router and configuration (router setup, environment-based thresholds, service-to-service auth middleware)
- [ ] 19. Implement OCR endpoint in FastAPI (POST /ai/ocr — PaddleOCR text extraction, face extraction from document, confidence scoring)
- [ ] 20. Implement face comparison endpoint in FastAPI (POST /ai/face-compare — DeepFace similarity calculation between selfie and document face)
- [ ] 21. Implement liveness detection endpoint in FastAPI (POST /ai/liveness — Silent-Face-Anti-Spoofing prediction, confidence scoring)
- [ ] 22. Create KYC screens folder structure with README (screens, components, hooks, types, tests)
- [ ] 23. Implement Document Capture Screen (camera interface, document overlay frame, corner detection, quality feedback with i18n)
- [ ] 24. Implement Selfie Capture Screen (front camera, face-shaped overlay, single face validation, capture guidance with i18n)
- [ ] 25. Implement KYC Status Screen (status display per state, retry button for REJECTED, banner/CTA for incomplete, progress indicator for PROCESSING)

## Task Dependency Graph

```json
{
  "waves": [
    [1, 2, 3, 18, 22],
    [4, 5, 10, 19, 20, 21, 23, 24],
    [6, 7, 8, 9, 11, 15, 25],
    [12, 13, 14, 16, 17]
  ]
}
```

## Notes

- The KYC flow is started during Cleaner onboarding (user-roles spec) but completion is fully async
- All ML models (PaddleOCR, DeepFace, Silent-Face-Anti-Spoofing) run on the self-hosted VPS — no external API calls
- Face embeddings are NEVER stored — only comparison scores persist
- Document images are encrypted at rest in MinIO and auto-deleted after configurable retention
- The AI service uses Bearer token authentication (env: AI_SERVICE_AUTH_TOKEN, rotatable, with X-Request-ID correlation, firewall restricted)
- BullMQ handles the processing pipeline to avoid blocking the API. Processing job has configurable retries with exponential backoff.
- The pipeline short-circuits on deterministic failures (e.g., OCR failure prevents face comparison)
- Image deletion in cleanup job is idempotent — if already deleted from MinIO, job succeeds without error
- Tasks 19-21 require ML model files downloaded and configured in the FastAPI service
- The offer acceptance guard (Task 16) integrates with the offers module (future spec) but the guard itself is standalone
- KYC status is derived from the latest kyc_verifications record (highest attempt_number) — no kyc_status column on users table
- Admin review (Tasks 13-14) uses granular permissions (kyc:read, kyc:review, kyc:approve, kyc:reject). Admin role management is out of scope.
- Upload endpoints accept Idempotency-Key header for mobile timeout/retry resilience
- Only explicitly required OCR fields are persisted — raw OCR output is NOT stored
- The term "liveness detection" refers to static PAD on captured images. Video-based liveness is out of scope for v1.
- KYC gate is enforced at API level (offer acceptance endpoint checks latest KYC verification status = VERIFIED)
- Threshold values must be calibrated against a representative test dataset before production. Default dev thresholds are for testing only.
