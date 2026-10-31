"""Whisper.cpp engine provider (Option A: no storage access).

Production binds a Whisper.cpp-backed engine here. Because the native binary is
not present in CI, the default provider returns a NotConfiguredEngine that
raises a typed UnusableAudioError; tests override the FastAPI dependency
``get_transcription_engine`` with a stub. This keeps the model out of the API
service and out of CI while preserving the exact request/response contract.
"""

from src.speech.exceptions import UnusableAudioError
from src.speech.transcription_service import TranscriptionEngine


class NotConfiguredEngine:
    """Placeholder engine used when no Whisper.cpp binary is configured.

    Every call raises so a misconfigured deployment surfaces clearly rather than
    silently returning empty transcripts. Tests override the dependency.
    """

    def transcribe(self, audio: bytes) -> tuple[str, str | None]:
        """Raise because no real engine is configured.

        Args:
            audio: Raw audio bytes (unused).

        Raises:
            UnusableAudioError: Always — no engine is configured.
        """
        raise UnusableAudioError("Transcription engine is not configured")


def get_transcription_engine() -> TranscriptionEngine:
    """Provide the transcription engine (overridden in tests / bound in prod).

    Returns:
        The configured TranscriptionEngine.
    """
    return NotConfiguredEngine()
