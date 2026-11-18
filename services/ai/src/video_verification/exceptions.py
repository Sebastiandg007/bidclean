"""Custom exceptions for the video-verification AI module.

Defines a small hierarchy for the on-arrival face-comparison endpoint. A "no usable face" outcome
is deliberately NOT an error here — it maps to an INCONCLUSIVE decision the caller treats as a
non-fatal advisory outcome.
"""


class VideoVerificationServiceError(Exception):
    """Base exception for all video-verification AI service errors.

    Attributes:
        message: Human-readable error description.
    """

    def __init__(self, message: str = "Video-verification service error") -> None:
        self.message = message
        super().__init__(self.message)


class InvalidMediaError(VideoVerificationServiceError):
    """Raised when the candidate video or reference image cannot be decoded.

    This covers unsupported/corrupt media, empty payloads, or a video from which no frame can be
    extracted.
    """

    def __init__(self, message: str = "Invalid or unsupported media") -> None:
        super().__init__(message)
