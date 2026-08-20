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


# --- Face Comparison Exceptions ---


class FaceComparisonError(KYCServiceError):
    """Base exception for face comparison failures.

    Parent exception for all face comparison domain errors.
    """

    def __init__(self, message: str = "Face comparison failed") -> None:
        super().__init__(message)


class NoFaceInSelfieError(FaceComparisonError):
    """Raised when no face is detected in the selfie image.

    The selfie must contain exactly one clearly visible face for comparison.
    """

    def __init__(self, message: str = "No face detected in selfie image") -> None:
        super().__init__(message)


class MultipleFacesError(FaceComparisonError):
    """Raised when multiple faces are detected in the selfie.

    Only a single face is allowed in the selfie for identity verification.
    """

    def __init__(
        self, message: str = "Multiple faces detected in selfie — only one allowed"
    ) -> None:
        super().__init__(message)


class FaceExtractionError(FaceComparisonError):
    """Raised when face embeddings cannot be extracted.

    This occurs when DeepFace fails to generate embeddings from a detected face,
    typically due to poor image quality or partial occlusion.
    """

    def __init__(self, message: str = "Cannot extract face embeddings") -> None:
        super().__init__(message)


# --- Liveness Detection Exceptions ---


class LivenessDetectionError(KYCServiceError):
    """Raised when liveness analysis fails.

    This occurs when the anti-spoofing model cannot analyze the image,
    typically due to poor quality, no face detected, or model failure.
    """

    def __init__(self, message: str = "Liveness detection failed") -> None:
        super().__init__(message)
