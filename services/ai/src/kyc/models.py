"""Pydantic request/response models for KYC endpoints.

These define the API contract for OCR, face comparison, and liveness
detection. Stub fields will be expanded in Tasks 19–21 as ML services
are integrated.
"""

from pydantic import BaseModel, Field

# --- OCR Models ---


class OCRResponse(BaseModel):
    """Response from the OCR text extraction endpoint.

    Attributes:
        extracted_name: Full name extracted from the document.
        document_number: Document ID number extracted.
        expiry_date: Document expiration date (ISO format or null).
        date_of_birth: Date of birth extracted (or null if not found).
        nationality: Nationality extracted (or null if not found).
        document_type: Detected document type (e.g., 'passport', 'id_card').
        confidence: Overall OCR confidence score (0.0–1.0).
        field_confidences: Per-field confidence scores.
        face_detected: Whether a face was detected in the document.
        face_image: Base64-encoded face crop for face comparison (or null).
    """

    extracted_name: str = ""
    document_number: str = ""
    expiry_date: str | None = None
    date_of_birth: str | None = None
    nationality: str | None = None
    document_type: str = ""
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    field_confidences: dict[str, float] = Field(default_factory=dict)
    face_detected: bool = False
    face_image: str | None = None


# --- Face Comparison Models ---


class FaceCompareResponse(BaseModel):
    """Response from the face comparison endpoint.

    Attributes:
        similarity_score: Cosine similarity between the two faces (0.0–1.0).
        is_match: Whether similarity exceeds the configured threshold.
    """

    similarity_score: float = Field(default=0.0, ge=0.0, le=1.0)
    is_match: bool = False


# --- Liveness Detection Models ---


class LivenessResponse(BaseModel):
    """Response from the liveness detection endpoint.

    Attributes:
        liveness_score: Probability the image is a live person (0.0–1.0).
        is_live: Whether liveness score exceeds the configured threshold.
    """

    liveness_score: float = Field(default=0.0, ge=0.0, le=1.0)
    is_live: bool = False
