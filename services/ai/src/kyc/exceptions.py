"""Custom exceptions for the KYC verification module.

Defines a hierarchy of domain-specific exceptions for OCR,
face comparison, and liveness operations.
"""


class KYCServiceError(Exception):
    """Base exception for all KYC service errors.

    Attributes:
        message: Human-readable error description.
    """

    def __init__(self, message: str = "KYC service error") -> None:
        self.message = message
        super().__init__(self.message)


class OCRExtractionError(KYCServiceError):
    """Raised when PaddleOCR cannot extract text from the document.

    This occurs when the image quality is too poor for OCR,
    the document is unrecognizable, or extraction yields no results.
    """

    def __init__(self, message: str = "Failed to extract text from document") -> None:
        super().__init__(message)


class NoFaceDetectedError(KYCServiceError):
    """Raised when no face is found in the document image.

    The document should contain a photo of the holder for face comparison.
    """

    def __init__(self, message: str = "No face detected in document image") -> None:
        super().__init__(message)


class InvalidImageError(KYCServiceError):
    """Raised when the uploaded image is invalid or unsupported.

    This covers unsupported file formats, corrupt files, images that
    are too small, or files that cannot be decoded.
    """

    def __init__(self, message: str = "Invalid or unsupported image format") -> None:
        super().__init__(message)
