# Video Verification

## Purpose

On-arrival face check (spec 18). It compares a frame from the arrival video against the reference KYC selfie with DeepFace and returns a similarity score and an advisory decision (`MATCH`, `NO_MATCH`, `INCONCLUSIVE`). The service receives bytes only and has no storage credentials. Embeddings stay in memory and are never persisted. The API worker re-derives the authoritative decision against the per-verification snapshot threshold.

## Files

| File | Responsibility |
|------|---------------|
| `__init__.py` | Module docstring. |
| `router.py` | `APIRouter(prefix="/verify-face")`; `POST /verify-face` takes multipart fields `candidate` and `reference`, requires the Bearer token. |
| `config.py` | `VideoVerificationSettings` and cached `get_video_verification_settings()`. |
| `models.py` | `VerifyFaceResponse`. |
| `exceptions.py` | `VideoVerificationServiceError`, `InvalidMediaError`. |
| `face_verify_service.py` | `FaceVerifyService` with an injectable `FrameExtractor` (`OpenCvFrameExtractor`) and `FaceEmbeddingEngine` (`DeepFaceEngine`). |

## Dependencies

- `kyc/auth.py` for service authentication.
- DeepFace and OpenCV.
- Consumed by `services/api/src/video-verification`.

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/verify-face` | Compare arrival-video frame vs reference selfie. 401 invalid token, 413 oversized media, 422 undecodable media |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AI_SERVICE_AUTH_TOKEN` | Bearer token for service-to-service auth | Yes |
| `VIDEO_VERIFICATION_SIMILARITY_THRESHOLD` | Minimum similarity for a MATCH hint (default 0.6) | No |
| `VIDEO_VERIFICATION_MAX_FILE_SIZE_MB` | Maximum media size in MB (default 20) | No |
