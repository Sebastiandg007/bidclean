"""Custom exceptions for the speech (transcription) domain."""


class SpeechError(Exception):
    """Base exception for all speech-service errors."""


class UnusableAudioError(SpeechError):
    """Raised when the provided audio cannot be decoded/transcribed."""


class EmptyAudioError(SpeechError):
    """Raised when no audio bytes were provided."""
