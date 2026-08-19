# Requirements Document

## Introduction

BidClean requires Cleaners to verify their identity before accepting any cleaning offers. The KYC (Know Your Customer) system validates identity through document OCR, face comparison, and liveness detection. All ML processing runs on self-hosted open source tools (PaddleOCR, DeepFace, Silent-Face-Anti-Spoofing) within the Python FastAPI microservice. The KYC flow is initiated during Cleaner onboarding but completes asynchronously — a Cleaner can explore the app while verification processes, but cannot accept offers until verified.

## Glossary

| Term | Definition |
|------|-----------|
| KYC | Know Your Customer — identity verification process required for Cleaners |
| OCR | Optical Character Recognition — extracting text from document images |
| Liveness Detection | Verifying a real person is present (not a photo/video of a photo). In this spec, refers to static presentation-attack detection (PAD) on captured images. Real-time video-based liveness challenges are out of scope for v1. |
| Face Comparison | Comparing the selfie face with the face on the identity document |
| Anti-Spoofing | Detecting presentation attacks (printed photos, screens, masks) |
| PaddleOCR | Open source OCR engine used for document text extraction |
| DeepFace | Open source face analysis library used for face comparison |
| Silent-Face-Anti-Spoofing | Open source liveness detection model |
| MinIO | S3-compatible object storage for encrypted document images |
| Retention Period | Configurable time after which document images are auto-deleted |
| Face Embedding | Mathematical representation of facial features (NOT stored permanently) |

## Requirements

### REQ-1: Document Capture
- The mobile app shall provide a camera interface for capturing identity documents
- Supported document types: national ID card, passport, driver's license
- The system shall validate image quality before upload (blur detection, lighting, resolution)
- Minimum resolution is configurable (env: `KYC_MIN_IMAGE_WIDTH`, `KYC_MIN_IMAGE_HEIGHT`)
- The system shall guide the user with an overlay frame showing correct document positioning
- The document must be fully visible within the frame (all four corners detected)
- If quality validation fails, the user is prompted to retake the photo with specific guidance (i18n keys for "too blurry", "low light", "document not fully visible")
- The captured image is uploaded to NestJS, which stores it encrypted in MinIO

### REQ-2: Document OCR
- The AI service shall extract text from the uploaded document image using PaddleOCR
- Required extracted fields: full name, document number, expiry date
- Optional extracted fields: date of birth, nationality, document type
- The system shall extract the photo from the document for face comparison
- OCR confidence score is calculated per field
- If overall OCR confidence is below the configurable threshold (env: `KYC_OCR_CONFIDENCE_THRESHOLD`), the document is flagged for manual review or the user is asked to retake
- The extracted name is cross-referenced with the user's registered name (fuzzy match)

### REQ-3: Selfie Capture with Liveness Detection
- The mobile app shall provide a front-facing camera interface for selfie capture
- Liveness detection runs via Silent-Face-Anti-Spoofing on the AI service
- The system shall detect and reject presentation attacks: printed photos, screen displays, 3D masks
- Liveness confidence must exceed a configurable threshold (env: `KYC_LIVENESS_THRESHOLD`) to pass
- If liveness fails, the user is informed and can retry (up to configurable max attempts via env: `KYC_MAX_ATTEMPTS`)
- The selfie capture UI shows a face-shaped overlay to guide positioning
- Only one face must be detected in the frame

### REQ-4: Face Comparison
- The AI service shall compare the selfie face with the document photo face using DeepFace
- A similarity score is calculated between the two faces
- The similarity score must exceed a configurable threshold (env: `KYC_FACE_SIMILARITY_THRESHOLD`) for verification to pass
- Face embeddings are used only during comparison and are NOT stored permanently
- If comparison fails, the user can retry with a new selfie (up to max attempts)
- The comparison result (pass/fail + score) is stored, not the embeddings
- Threshold values must be calibrated and validated against a representative test dataset before production deployment. Default development thresholds are for testing only.

### REQ-5: KYC State Management
- KYC verification follows a state machine: `NOT_STARTED` → `DOCUMENT_UPLOADED` → `SELFIE_UPLOADED` → `PROCESSING` → `VERIFIED` / `REJECTED`
- Each state transition is recorded with a timestamp
- A rejected verification can be retried (new attempt created, previous preserved for audit)
- Maximum number of retry attempts is configurable (env: `KYC_MAX_RETRY_ATTEMPTS`)
- After max retries, the case is escalated to admin review
- State transitions are atomic and idempotent
- The current KYC state is accessible from the user profile

### REQ-6: Admin Review
- An admin endpoint allows manual review of edge cases (low confidence, failed auto-verification)
- Admins can view: document image, selfie image, OCR results, face comparison score, liveness score
- Admins can approve or reject a verification with a reason
- Admin decisions override automated results
- Pending admin reviews are surfaced in a queue with priority (oldest first)
- Admin actions are logged for audit

### REQ-7: Data Retention and Privacy
- Document images are stored encrypted at rest in MinIO (AES-256)
- Document images are auto-deleted after a configurable retention period (env: `KYC_RETENTION_DAYS`)
- Face embeddings are NEVER stored permanently — only used during comparison
- Only the verification result (pass/fail, scores, extracted fields) is stored long-term
- Users can request deletion of their KYC data (GDPR right to erasure)
- All KYC data access is logged for audit compliance
- The system stores only the minimum data necessary for verification

### REQ-8: Integration with User Profile
- KYC status is visible in the Cleaner profile (NOT_STARTED, PROCESSING, VERIFIED, REJECTED)
- A Cleaner CANNOT accept any offers until KYC status is VERIFIED
- The mobile app shows the current KYC status in the Cleaner main view
- If KYC is not verified, a prominent banner/CTA directs the user to complete verification
- KYC completion does not block exploring the app (viewing offers, setting preferences)
- Push notification sent when KYC status changes (verified or rejected with reason)

## Non-Functional Requirements

- Document upload must complete within configurable timeout on standard mobile connection
- AI processing (OCR + face comparison + liveness) must complete within configurable timeout (env: `KYC_PROCESSING_TIMEOUT_MS`)
- The system must handle concurrent verifications (target configurable via env: `KYC_MAX_CONCURRENT`)
- All ML models run on the self-hosted VPS — no external API calls
- Encrypted storage uses AES-256 with server-managed keys
- KYC endpoints are rate-limited (configurable via env: `KYC_RATE_LIMIT_PER_HOUR`)
- Document image max file size configurable (env: `KYC_MAX_FILE_SIZE_MB`)
- System availability for KYC processing: 99.5%

## Out of Scope

- Host identity verification (Hosts do not need KYC in v1)
- Video-based liveness challenges (only static image-based anti-spoofing in v1)
- Third-party KYC providers (all processing is self-hosted)
- Document authenticity verification (hologram detection, MRZ validation) — future enhancement
- Real-time camera liveness (processing happens after capture, on the server)
- Background check / criminal record verification
- Multi-document verification (only one document required)
