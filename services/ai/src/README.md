# AI Source (`services/ai/src`)

## Purpose

Source root of the FastAPI AI microservice. `main.py` creates the app, adds the `X-Request-ID` middleware (propagates the incoming header or generates a UUID) and mounts the routers. Each feature is a sub-package with its own router, configuration, models and exceptions.

## Files

| File / Folder | Responsibility |
|---------------|---------------|
| `main.py` | FastAPI app (`BidClean AI Service`, v0.1.0), request-id middleware, `include_router` for `health`, `kyc`, `speech` and `video_verification`. The `translation` and `pricing` `include_router` calls are commented out. |
| `__init__.py` | Package marker. |
| [`health/`](health/README.md) | `GET /health/` liveness. Mounted. |
| [`kyc/`](kyc/README.md) | Document OCR, face comparison, liveness (`/ai/*`). Mounted. |
| [`speech/`](speech/README.md) | `POST /transcribe` speech-to-text. Mounted. |
| [`video_verification/`](video_verification/README.md) | `POST /verify-face` arrival face check. Mounted. |
| [`translation/`](translation/README.md) | Placeholder, router not mounted. |
| [`pricing/`](pricing/README.md) | Placeholder, router not mounted. |
| [`verification/`](verification/README.md) | Empty placeholder package (no router). |

## Dependencies

- FastAPI, pydantic-settings, python-multipart, OpenCV, Pillow, NumPy.
- Optional `ml` Poetry group: PaddleOCR, PaddlePaddle, DeepFace.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health/` | Service health |
| POST | `/ai/ocr` | Document OCR plus face detection |
| POST | `/ai/face-compare` | Selfie vs document face similarity |
| POST | `/ai/liveness` | Liveness / spoofing detection |
| POST | `/transcribe` | Voice-note transcription |
| POST | `/verify-face` | Arrival-video face verification |

## How to Run

```powershell
# PowerShell
cd services/ai
poetry install
poetry run uvicorn src.main:app --reload --port 8000
```
