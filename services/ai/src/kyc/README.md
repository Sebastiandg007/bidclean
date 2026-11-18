# KYC

## Purpose

AI-powered identity verification used by the API `kyc` module: OCR and face extraction from identity documents, selfie-vs-document face comparison, and liveness (anti-spoofing) detection. Every endpoint needs the service-to-service Bearer token and propagates `X-Request-ID`. Each engine sits behind a Protocol so tests can inject stubs without the ML models.

## Files

| File | Responsibility |
|------|---------------|
| `__init__.py` | Module docstring. |
| `router.py` | `APIRouter(prefix="/ai")` with `/ocr`, `/face-compare`, `/liveness`; router-level dependency `verify_service_token`. |
| `auth.py` | `verify_service_token`: validates the `Authorization: Bearer` header against `AI_SERVICE_AUTH_TOKEN` (401 otherwise) and logs `X-Request-ID`. Reused by `speech` and `video_verification`. |
| `config.py` | `KYCSettings` (pydantic-settings) and cached `get_kyc_settings()`. |
| `models.py` | Response models `OCRResponse`, `FaceCompareResponse`, `LivenessResponse`. |
| `exceptions.py` | `KYCServiceError` hierarchy (OCR, no face, invalid image, face comparison, liveness). |
| `ocr_service.py` | `OCRService` with `PaddleOCREngine` and `OpenCVFaceDetector` (`OCREngine` / `FaceDetector` protocols). |
| `face_compare_service.py` | `FaceCompareService` with `DeepFaceEngine` (cosine similarity and threshold). |
| `liveness_service.py` | `LivenessService` with `SilentFaceEngine` (presentation-attack detection). |

## Dependencies

- PaddleOCR, DeepFace, OpenCV (ML group in `pyproject.toml`).
- Consumed by `services/api/src/kyc/ai-client`.

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/ocr` | Extract text and face from a document image |
| POST | `/ai/face-compare` | Compare two face images and return similarity |
| POST | `/ai/liveness` | Detect liveness/spoofing in a selfie |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AI_SERVICE_AUTH_TOKEN` | Bearer token for service-to-service auth | Yes |
| `KYC_OCR_CONFIDENCE_THRESHOLD` | Minimum OCR confidence (default 0.7) | No |
| `KYC_FACE_SIMILARITY_THRESHOLD` | Minimum face similarity (default 0.6) | No |
| `KYC_LIVENESS_THRESHOLD` | Minimum liveness score (default 0.8) | No |
| `KYC_MAX_FILE_SIZE_MB` | Maximum upload size in MB (default 10) | No |
