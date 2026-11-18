"""Transcription service — Whisper.cpp (CPU) behind a swappable engine.

The service owns no storage access (Option A): callers pass audio BYTES and get
back text + a detected language. The actual model is hidden behind the
``TranscriptionEngine`` protocol so tests (and CI without the native Whisper.cpp
binary) can inject a stub, while production binds a real Whisper.cpp engine.

Audio bytes and transcript text are treated as sensitive user-derived content
and are never logged.
"""

import logging
from typing import Protocol

from src.speech.exceptions import EmptyAudioError, UnusableAudioError

logger = logging.getLogger(__name__)


class TranscriptionEngine(Protocol):
    """The minimal engine contract the service depends on.

    Implementations wrap Whisper.cpp (or a stub in tests). They must not touch
    storage or the network beyond the local model.
    """

    def transcribe(self, audio: bytes) -> tuple[str, str | None]:
        """Transcribe raw audio bytes.

        Args:
            audio: Raw audio container bytes (e.g. wav/mp3/mp4/ogg).

        Returns:
            A tuple of (text, language) where language may be None.

        Raises:
            UnusableAudioError: If the audio cannot be decoded/transcribed.
        """
        ...


class TranscriptionService:
    """Coordinates transcription requests against a ``TranscriptionEngine``.

    Validates the input, delegates to the engine, and normalizes failures into
    typed exceptions the router maps to HTTP responses.
    """

    def __init__(self, engine: TranscriptionEngine) -> None:
        """Initialize with a concrete transcription engine.

        Args:
            engine: The Whisper.cpp-backed (or stubbed) engine implementation.
        """
        self._engine = engine

    def transcribe(self, audio: bytes) -> tuple[str, str | None]:
        """Transcribe audio bytes to text + detected language.

        Args:
            audio: Raw audio bytes received over multipart upload.

        Returns:
            A tuple of (text, language); language may be None when not detected.

        Raises:
            EmptyAudioError: If no audio bytes were provided.
            UnusableAudioError: If the engine cannot transcribe the audio.
        """
        if not audio:
            raise EmptyAudioError("No audio bytes provided")

        try:
            text, language = self._engine.transcribe(audio)
        except UnusableAudioError:
            raise
        except Exception as exc:  # noqa: BLE001 - normalize any engine failure
            logger.warning("Transcription engine failed (%s)", type(exc).__name__)
            raise UnusableAudioError("Audio could not be transcribed") from exc

        return text, language
