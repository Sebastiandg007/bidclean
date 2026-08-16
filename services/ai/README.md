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
| `verification/` | KYC: document OCR (PaddleOCR) + face comparison (DeepFace) + liveness | 🔲 Planned |
| `translation/` | Text translation (LibreTranslate) + language detection | 🔲 Planned |
| `speech/` | Speech-to-text (Whisper.cpp) + Text-to-speech (Piper) | 🔲 Planned |
| `pricing/` | AI price estimation based on property photos/data (Bedrock) | 🔲 Planned |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health check |

## How to Run

```bash
cd services/ai
poetry install
poetry run uvicorn src.main:app --reload --port 8000
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Service port (default: 8000) | No |
| `AWS_REGION` | AWS region for Bedrock | Yes |
| `LIBRE_TRANSLATE_URL` | LibreTranslate service URL | Yes |
