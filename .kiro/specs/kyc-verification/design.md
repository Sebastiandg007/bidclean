# Design Document

## Overview

The KYC verification system uses a three-service architecture: the mobile app captures documents and selfies, the NestJS API orchestrates the flow and manages state, and the Python FastAPI AI service performs ML processing (OCR, face comparison, liveness detection). All ML models are open source and self-hosted. Document images are stored encrypted in MinIO with configurable auto-deletion. Biometric data (face embeddings) exists only in memory during comparison and is never persisted.

### Responsibility Matrix

| Responsibility | Mobile App | NestJS API | FastAPI AI Service |
|----------------|-----------|------------|-------------------|
| Document capture (camera) | ✅ | ❌ | ❌ |
| Image quality validation (client-side) | ✅ | ❌ | ❌ |
| Selfie capture | ✅ | ❌ | ❌ |
| Image upload/storage | ❌ | ✅ (MinIO) | ❌ |
| KYC state management | ❌ | ✅ | ❌ |
| OCR text extraction | ❌ | ❌ | ✅ (PaddleOCR) |
| Face comparison | ❌ | ❌ | ✅ (DeepFace) |
| Liveness detection | ❌ | ❌ | ✅ (Silent-Face) |
| Admin review | ❌ | ✅ | ❌ |
| Data retention/deletion | ❌ | ✅ (cron) | ❌ |
| Push notifications | ❌ | ✅ (OneSignal) | ❌ |

## Architecture

The system follows a pipeline architecture where the mobile captures media, NestJS orchestrates and persists state, and FastAPI performs compute-heavy ML processing.

```
Mobile App (Expo)
├── Document Capture Screen (camera + quality validation)
├── Selfie Capture Screen (front camera + face overlay)
└── KYC Status Screen (current state + retry option)
        ↓ upload images
NestJS API (orchestrator)
├── POST /kyc/document — receive document, store in MinIO, update state
├── POST /kyc/selfie — receive selfie, store in MinIO, enqueue BullMQ processing job
├── GET /kyc/status — return current verification state
├── POST /kyc/retry — start new attempt
├── GET /admin/kyc/queue — admin review queue
├── POST /admin/kyc/:id/decision — admin approve/reject
        ↓ internal HTTP calls
FastAPI AI Service (processor)
├── POST /ai/ocr — extract text + photo from document
├── POST /ai/face-compare — compare selfie vs document face
└── POST /ai/liveness — detect spoofing in selfie
        ↓ results
NestJS API
├── Evaluates results against configurable thresholds
├── Updates KYC state (VERIFIED / REJECTED)
├── Sends push notification via OneSignal
└── Schedules data cleanup via BullMQ
```

## Components and Interfaces

### API Endpoints (NestJS)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/kyc/document` | Upload identity document image (accepts Idempotency-Key header) | Access token (Cleaner role) |
| POST | `/kyc/selfie` | Upload selfie image, enqueues processing (accepts Idempotency-Key header) | Access token (Cleaner role) |
| GET | `/kyc/status` | Get current KYC verification status | Access token (Cleaner role) |
| POST | `/kyc/retry` | Start a new verification attempt | Access token (Cleaner role) |
| GET | `/admin/kyc/queue` | Get pending verifications for review | Admin token |
| GET | `/admin/kyc/:id` | Get full verification details | Admin token |
| POST | `/admin/kyc/:id/decision` | Approve or reject verification | Admin token |

### AI Service Endpoints (FastAPI)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/ai/ocr` | Extract text and face from document image | Internal (Bearer token from env: AI_SERVICE_AUTH_TOKEN, rotatable, correlation ID via X-Request-ID header, firewall restricted to internal network) |
| POST | `/ai/face-compare` | Compare two face images, return similarity score | Internal (Bearer token from env: AI_SERVICE_AUTH_TOKEN, rotatable, correlation ID via X-Request-ID header, firewall restricted to internal network) |
| POST | `/ai/liveness` | Detect liveness/spoofing in selfie image | Internal (Bearer token from env: AI_SERVICE_AUTH_TOKEN, rotatable, correlation ID via X-Request-ID header, firewall restricted to internal network) |

### Component Structure (Backend — NestJS)

```
services/api/src/kyc/
├── kyc.module.ts
├── kyc.controller.ts
├── kyc.service.ts
├── kyc.types.ts
├── state-machine/
│   ├── kyc-state-machine.ts
│   └── kyc-state-machine.spec.ts
├── ai-client/
│   ├── ai-client.service.ts
│   └── ai-client.types.ts
├── storage/
│   ├── kyc-storage.service.ts
│   └── kyc-storage.types.ts
├── admin/
│   ├── kyc-admin.controller.ts
│   └── kyc-admin.service.ts
├── jobs/
│   ├── kyc-process.job.ts
│   └── kyc-cleanup.job.ts
├── dto/
│   ├── upload-document.dto.ts
│   ├── upload-selfie.dto.ts
│   └── admin-decision.dto.ts
├── entities/
│   └── kyc-verification.entity.ts
├── __tests__/
│   ├── kyc.service.spec.ts
│   ├── kyc-state-machine.spec.ts
│   └── kyc-admin.service.spec.ts
└── README.md
```

### Component Structure (AI Service — FastAPI)

```
services/ai/src/kyc/
├── __init__.py
├── router.py
├── ocr_service.py
├── face_compare_service.py
├── liveness_service.py
├── models.py
├── config.py
└── tests/
    ├── test_ocr_service.py
    ├── test_face_compare_service.py
    └── test_liveness_service.py
```

### Component Structure (Mobile)

```
apps/mobile/src/screens/kyc/
├── DocumentCaptureScreen.tsx
├── SelfieCaptureScreen.tsx
├── KycStatusScreen.tsx
├── useKyc.ts
├── kyc.types.ts
├── components/
│   ├── DocumentOverlay.tsx
│   ├── FaceOverlay.tsx
│   └── QualityFeedback.tsx
├── __tests__/
│   ├── DocumentCaptureScreen.spec.tsx
│   ├── SelfieCaptureScreen.spec.tsx
│   └── KycStatusScreen.spec.tsx
└── README.md
```

## Data Models

### KYC Verifications Table

```sql
CREATE TABLE kyc_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED',
    attempt_number INTEGER NOT NULL DEFAULT 1,
    document_type VARCHAR(30),
    document_storage_key VARCHAR(512),
    selfie_storage_key VARCHAR(512),
    extracted_name VARCHAR(255),
    extracted_document_number VARCHAR(100),
    extracted_expiry_date DATE,
    extracted_document_type VARCHAR(30),
    ocr_confidence NUMERIC(5,4),
    face_similarity_score NUMERIC(5,4),
    liveness_score NUMERIC(5,4),
    name_match_score NUMERIC(5,4),
    processing_attempts INTEGER DEFAULT 0,
    last_processing_error TEXT,
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    document_uploaded_at TIMESTAMP WITH TIME ZONE,
    selfie_uploaded_at TIMESTAMP WITH TIME ZONE,
    processing_started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_kyc_user_attempt UNIQUE(user_id, attempt_number),
    CONSTRAINT chk_attempt_number CHECK (attempt_number > 0)
);

-- Current attempt = highest attempt_number for a given user_id
CREATE INDEX idx_kyc_user_attempt ON kyc_verifications(user_id, attempt_number DESC);
CREATE INDEX idx_kyc_verifications_user ON kyc_verifications(user_id);
CREATE INDEX idx_kyc_verifications_status ON kyc_verifications(status);
CREATE INDEX idx_kyc_verifications_review ON kyc_verifications(status, created_at)
    WHERE status = 'REJECTED' OR status = 'PROCESSING';
```

### KYC Audit Log Table

```sql
CREATE TABLE kyc_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id UUID NOT NULL REFERENCES kyc_verifications(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    old_status VARCHAR(30),
    new_status VARCHAR(30),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_kyc_audit_logs_verification ON kyc_audit_logs(verification_id);
CREATE INDEX idx_kyc_audit_logs_actor ON kyc_audit_logs(actor_id);
```

### KYC Status Derivation

> **Note:** KYC status is derived from the latest verification attempt (highest `attempt_number` for a given `user_id`). No `kyc_status` column on users table. Query the `kyc_verifications` table with `idx_kyc_user_attempt` index for current status.

## KYC Processing Flow

### Happy Path Flow

```
1. Cleaner opens KYC flow from onboarding/banner
        ↓
2. Document Capture Screen → captures ID photo
        ↓
3. Client-side quality check (blur, resolution, corners)
        ↓ pass
4. POST /kyc/document → NestJS stores encrypted in MinIO
        ↓ state: DOCUMENT_UPLOADED
5. Selfie Capture Screen → captures front-facing selfie
        ↓
6. POST /kyc/selfie → NestJS stores encrypted in MinIO
        ↓ state: SELFIE_UPLOADED
7. NestJS automatically enqueues BullMQ processing job (triggered by selfie upload)
        ↓ state: PROCESSING
8. Pipeline short-circuits on deterministic failures:
   Each step validates prerequisites before executing.
   If OCR cannot read the document, face comparison is not attempted.
        ↓
8a. Job calls FastAPI /ai/ocr → extracts text + face from document
        ↓ (short-circuits if OCR fails)
9. Job calls FastAPI /ai/liveness → verifies selfie is real
        ↓ (short-circuits if liveness fails)
10. Job calls FastAPI /ai/face-compare → compares faces
        ↓
11. NestJS evaluates all scores against configurable thresholds (env vars)
        ↓ all pass
12. State: VERIFIED → push notification → user can accept offers
```

### Rejection + Retry Flow

```
11b. One or more scores below threshold
        ↓
12b. State: REJECTED with reason
        ↓
13b. Push notification with rejection reason
        ↓
14b. User opens app, sees REJECTED status + retry button
        ↓
15b. POST /kyc/retry → creates new attempt (preserves old for audit)
        ↓
16b. Repeat from step 2
```

## Error Handling

| Error Case | HTTP Status | Response |
|-----------|-------------|----------|
| Not a Cleaner (no cleaner role) | 403 | Requires Cleaner role (i18n: `kyc.error.not_cleaner`) |
| Document already uploaded (state conflict) | 409 | Document already uploaded (i18n: `kyc.error.document_exists`) |
| Invalid file type | 400 | Unsupported file type (i18n: `kyc.error.invalid_file_type`) |
| File too large | 413 | File exceeds max size (i18n: `kyc.error.file_too_large`) |
| Max retry attempts reached | 429 | Max attempts reached (i18n: `kyc.error.max_attempts`) |
| AI service unavailable | 503 | Service unavailable (i18n: `kyc.error.service_unavailable`) |
| OCR extraction failed | 422 | Could not read document (i18n: `kyc.error.ocr_failed`) |
| No face detected in document | 422 | No face in document (i18n: `kyc.error.no_face_document`) |
| Multiple faces in selfie | 422 | Multiple faces detected (i18n: `kyc.error.multiple_faces`) |
| Liveness check failed | 422 | Liveness failed (i18n: `kyc.error.liveness_failed`) |
| KYC already verified | 409 | Already verified (i18n: `kyc.error.already_verified`) |

## Testing Strategy

### Unit Tests (NestJS)
- KYC state machine: all valid transitions, rejection of invalid transitions, idempotency
- KYC service: document upload flow, selfie upload flow, processing trigger, retry logic
- AI client service: request formatting, response parsing, error handling
- Admin service: queue retrieval, decision application, audit logging

### Unit Tests (FastAPI)
- OCR service: text extraction with sample images, confidence scoring, face extraction
- Face comparison service: similarity calculation, threshold evaluation
- Liveness service: spoofing detection, confidence scoring

### Component Tests (Mobile)
- DocumentCaptureScreen: camera permission, overlay rendering, quality feedback
- SelfieCaptureScreen: front camera, face overlay, single face validation
- KycStatusScreen: status display per state, retry button visibility, banner display

### Integration Tests
- Full KYC pipeline: upload document → upload selfie → process → verify
- Retry flow: rejection → retry → success
- Admin flow: processing → admin review → approve/reject

## Correctness Properties

### Property 1: State Machine Integrity
KYC status can only transition through valid paths: NOT_STARTED → DOCUMENT_UPLOADED → SELFIE_UPLOADED → PROCESSING → VERIFIED/REJECTED. No state can be skipped or transition backwards (except via retry which creates a new attempt).

**Validates: Requirements 5**

### Property 2: No Permanent Biometric Storage
Face embeddings never persist to any storage layer. They exist only in memory during the comparison operation and are discarded immediately after scoring.

**Validates: Requirements 4, 7**

### Property 3: Verification Gate
A Cleaner with KYC status other than VERIFIED cannot accept any offers. This is enforced at the API level regardless of frontend state.

**Validates: Requirements 8**

### Property 4: Attempt Immutability
Once a KYC attempt is completed (VERIFIED or REJECTED), its data is never modified. Retries create new attempt records.

**Validates: Requirements 5, 6**

### Property 5: Encrypted At Rest
All document and selfie images stored in MinIO are encrypted. No unencrypted biometric images exist in persistent storage.

**Validates: Requirements 7**

### Property 6: Auto-Deletion Guarantee
Document images are deleted after the configurable retention period. No document image persists beyond the retention window.

**Validates: Requirements 7**

### Property 7: Audit Trail Completeness
Every state transition, admin decision, and data access is recorded in the audit log with actor, timestamp, and action.

**Validates: Requirements 6, 7**

### Property 8: Threshold Configurability
All verification thresholds (OCR confidence, face similarity, liveness score) are loaded from environment variables at runtime. Changing thresholds does not require code changes or redeployment.

**Validates: Requirements 2, 3, 4**

## Implementation Notes

### Processing & Retries
- BullMQ processing job has configurable retries (env: `KYC_PROCESSING_MAX_RETRIES`) with exponential backoff (env: `KYC_PROCESSING_BACKOFF_MS`). After max retries, verification enters admin review.
- The pipeline short-circuits on deterministic failures: if OCR cannot read the document, face comparison is not attempted. Each step validates prerequisites before executing.

### Data Storage
- Only explicitly required extracted fields are persisted (`extracted_name`, `extracted_document_number`, `extracted_expiry_date`, `extracted_document_type`). Raw OCR output is NOT stored.
- KYC status is derived from the latest verification attempt. No `kyc_status` column on users table.

### Image Cleanup
- Image deletion in cleanup job is idempotent — if object already deleted from MinIO, job succeeds without error.

### Idempotency
- Upload endpoints (`POST /kyc/document`, `POST /kyc/selfie`) accept an `Idempotency-Key` header to prevent duplicate uploads on mobile timeout/retry.

### Audit Log Actions
Tracked actions in `kyc_audit_logs`:
- `DOCUMENT_VIEWED` — Admin viewed document image
- `SELFIE_VIEWED` — Admin viewed selfie image
- `OCR_VIEWED` — Admin viewed OCR extraction results
- `VERIFICATION_APPROVED` — Admin approved verification
- `VERIFICATION_REJECTED` — Admin rejected verification
- `DOCUMENT_DELETED` — Document image deleted (auto or manual)
- `SELFIE_DELETED` — Selfie image deleted (auto or manual)

> Admin access to images is logged for GDPR compliance.

### Admin Authorization
- Admin authorization uses granular permissions (`kyc:read`, `kyc:review`, `kyc:approve`, `kyc:reject`) separate from Host/Cleaner roles. Admin role management is out of scope for this spec.

### Liveness Detection Scope
- The term "liveness detection" in this spec refers to static presentation-attack detection (PAD) on captured images. Real-time video-based liveness challenges are out of scope for v1.

### KYC Gate Enforcement
- KYC gate is enforced at API level (offer acceptance endpoint checks latest KYC verification status = VERIFIED).

## Dependencies

### Backend (NestJS)
- Existing `users` table from `user-authentication` spec
- JWT auth guard (from auth module)
- Role guard (from roles module — Cleaner role required)
- MinIO client (`minio` npm package) for encrypted object storage
- BullMQ for async processing jobs
- OneSignal SDK for push notifications
- `axios` for internal HTTP calls to FastAPI

### AI Service (FastAPI)
- `paddleocr` — Document OCR
- `deepface` — Face comparison
- `silent-face-anti-spoofing` — Liveness detection
- `opencv-python` — Image preprocessing
- `numpy` — Numerical operations
- `pillow` — Image handling

### Mobile
- `expo-camera` — Document and selfie capture
- `expo-image-manipulator` — Client-side image quality validation
- Zustand store extension for KYC state
- Reanimated 3 for capture UI animations
