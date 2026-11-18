# Speech

## Purpose

Speech-to-text for chat voice notes. The service receives audio bytes only and has no storage credentials: the API transcription worker reads the object from MinIO and posts the bytes here. The engine sits behind a `TranscriptionEngine` protocol. Audio and transcript text are never logged. Text-to-speech (Piper) is not implemented.

## Files

| File | Responsibility |
|------|---------------|
| `__init__.py` | Package marker. |
| `router.py` | `APIRouter(prefix="/transcribe")`; `POST /transcribe` takes multipart field `audio`, requires the Bearer token (`verify_service_token` from `kyc/auth.py`) and returns `{ text, language }`. |
| `config.py` | `SpeechSettings` and cached `get_speech_settings()`. |
| `models.py` | `TranscribeResponse` (`text`, `language`). |
| `exceptions.py` | `SpeechError`, `UnusableAudioError`, `EmptyAudioError` (mapped to 422). |
| `transcription_service.py` | `TranscriptionService` and the `TranscriptionEngine` protocol. |
| `engine.py` | `get_transcription_engine()`. Currently returns `NotConfiguredEngine`, which raises `UnusableAudioError` until a Whisper.cpp binary is bound. Tests override this dependency with a stub. |

## Dependencies

- `kyc/auth.py` for service authentication.
- Whisper.cpp (CPU) is the intended production engine; it is not yet bound in `engine.py`.

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/transcribe` | Transcribe an audio clip; 401 without a valid token, 422 for empty, oversized or unusable audio |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AI_SERVICE_AUTH_TOKEN` | Bearer token for service-to-service auth | Yes |
| `WHISPER_MODEL` | Whisper.cpp model name (default `base`) | No |
| `WHISPER_LANGUAGE` | Forced language code; empty means auto-detect | No |
| `SPEECH_MAX_AUDIO_BYTES` | Maximum audio size in bytes (default 26214400) | No |
