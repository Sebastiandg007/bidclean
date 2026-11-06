"""Speech (transcription) API router.

Exposes ``POST /transcribe`` which accepts audio BYTES via multipart upload and
returns ``{ text, language }``. Service-to-service auth reuses the shared Bearer
token dependency. The concrete Whisper.cpp engine is provided via a FastAPI
dependency so it can be overridden in tests with a stub (no native binary in CI).
"""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from src.kyc.auth import verify_service_token
from src.speech.config import SpeechSettings, get_speech_settings
from src.speech.engine import get_transcription_engine
from src.speech.exceptions import EmptyAudioError, UnusableAudioError
from src.speech.models import TranscribeResponse
from src.speech.transcription_service import TranscriptionEngine, TranscriptionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transcribe", tags=["speech"])


def get_transcription_service(
    engine: TranscriptionEngine = Depends(get_transcription_engine),
) -> TranscriptionService:
    """Provide a TranscriptionService bound to the configured engine.

    Args:
        engine: The injected transcription engine (overridable in tests).

    Returns:
        A ready TranscriptionService.
    """
    return TranscriptionService(engine)


@router.post("", response_model=TranscribeResponse, status_code=status.HTTP_200_OK)
async def transcribe(
    audio: UploadFile = File(...),
    _request_id: str | None = Depends(verify_service_token),
    settings: SpeechSettings = Depends(get_speech_settings),
    service: TranscriptionService = Depends(get_transcription_service),
) -> TranscribeResponse:
    """Transcribe an uploaded audio clip.

    Args:
        audio: The multipart audio file (bytes only; no storage reference).
        _request_id: Correlation id from the authenticated caller.
        settings: Speech configuration (size bound).
        service: The transcription service.

    Returns:
        The recognized text and detected language.

    Raises:
        HTTPException: 422 when the audio is empty, too large, or unusable.
    """
    data = await audio.read()

    if len(data) > settings.speech_max_audio_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Audio exceeds the maximum allowed size",
        )

    try:
        text, language = service.transcribe(data)
    except EmptyAudioError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No audio provided",
        ) from exc
    except UnusableAudioError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Audio could not be transcribed",
        ) from exc

    return TranscribeResponse(text=text, language=language)
