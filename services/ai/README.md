# @bidclean/ai

## Purpose

AI/ML microservice for BidClean. Handles all machine learning, computer vision, and natural language processing tasks. Communicates with the NestJS API via internal HTTP.

## Tech

- **Framework:** FastAPI (Python 3.11+)
- **Package Manager:** Poetry
- **Linter:** Ruff
- **Testing:** pytest + Hypothesis

## Modules

| Module | Responsibility | Status |
|--------|---------------|--------|
| `health/` | Health check endpoint | ✅ Active |
| `kyc/` | KYC: document OCR (PaddleOCR) + face comparison (DeepFace) + liveness (Silent-Face) | ✅ Active |
| `translation/` | Text translation (LibreTranslate) + language detection | 🔲 Planned |
| `speech/` | Speech-to-text for voice notes (Whisper.cpp, Spec 14) + Text-to-speech (Piper) | 🟡 Transcription active |
| `pricing/` | AI price estimation based on property photos/data (Bedrock) | 🔲 Planned |

## API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/health` | Service health check | None |
| POST | `/ai/ocr` | Extract text and face from document image | Bearer token |
| POST | `/ai/face-compare` | Compare two face images, return similarity | Bearer token |
| POST | `/ai/liveness` | Detect liveness/spoofing in selfie | Bearer token |
| POST | `/transcribe` | Transcribe a voice-note audio clip (bytes only) → `{ text, language }` | Bearer token |

### `/transcribe` (voice notes, Spec 14)

Accepts audio **bytes** via multipart (`audio` field) and returns `{ text, language }`.
**Option A**: the AI service receives only the bytes and is given **no MinIO/storage access** — the
NestJS transcription worker fetches the object from storage and posts the bytes here. Whisper.cpp
runs on CPU behind a swappable `TranscriptionEngine` (so CI/tests inject a stub without the native
binary). Audio and transcript text are never logged. Errors: `422` for empty/oversized/unusable
audio, `401` for a missing/invalid Bearer token.

```
src/speech/
├── router.py                 # POST /transcribe (multipart bytes → { text, language })
├── config.py                 # SpeechSettings (whisper model/lang, max audio bytes)
├── models.py                 # TranscribeResponse
├── exceptions.py             # SpeechError / UnusableAudioError / EmptyAudioError
├── transcription_service.py  # TranscriptionService + TranscriptionEngine protocol
└── engine.py                 # get_transcription_engine() (Whisper.cpp in prod; stub in tests)
```

## KYC Module Structure

```
src/kyc/
├── __init__.py              # Module docstring
├── router.py                # FastAPI router with endpoint definitions
├── auth.py                  # Service-to-service auth dependency
├── config.py                # Environment-based configuration (pydantic-settings)
├── models.py                # Pydantic request/response models
├── exceptions.py            # Custom exception hierarchy (KYCServiceError, OCR, Face, Image)
├── ocr_service.py           # OCR implementation (PaddleOCR text extraction + OpenCV face detection)
├── face_compare_service.py  # Face comparison (DeepFace cosine similarity + threshold evaluation)
└── liveness_service.py      # Liveness detection (Silent-Face-Anti-Spoofing PAD prediction)
```

## How to Run

```bash
cd services/ai
poetry install
poetry run uvicorn src.main:app --reload --port 8000
```

## How to Test

```bash
cd services/ai
poetry run pytest
```

## How to Lint

```bash
cd services/ai
poetry run ruff check src/
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Service port | No | 8000 |
| `AI_SERVICE_AUTH_TOKEN` | Bearer token for service-to-service auth | Yes | — |
| `KYC_OCR_CONFIDENCE_THRESHOLD` | Minimum OCR confidence (0.0–1.0) | No | 0.7 |
| `KYC_FACE_SIMILARITY_THRESHOLD` | Minimum face similarity (0.0–1.0) | No | 0.6 |
| `KYC_LIVENESS_THRESHOLD` | Minimum liveness score (0.0–1.0) | No | 0.8 |
| `KYC_MAX_FILE_SIZE_MB` | Maximum upload file size in MB | No | 10 |
| `WHISPER_MODEL` | Whisper.cpp model name/size for `/transcribe` | No | base |
| `WHISPER_LANGUAGE` | Forced language code (empty = auto-detect) | No | (auto) |
| `SPEECH_MAX_AUDIO_BYTES` | Reject `/transcribe` audio larger than this | No | 26214400 |
| `AWS_REGION` | AWS region for Bedrock | Yes | — |
| `LIBRE_TRANSLATE_URL` | LibreTranslate service URL | Yes | — |

## Authentication

All `/ai/*` endpoints require a `Bearer` token in the `Authorization` header.
The token is validated against the `AI_SERVICE_AUTH_TOKEN` environment variable.
Requests should include an `X-Request-ID` header for correlation tracking.
