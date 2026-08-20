"""KYC router — API endpoints for identity verification.

Provides OCR, face comparison, and liveness detection endpoints.
All routes require service-to-service Bearer token authentication.
"""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from src.kyc.auth import verify_service_token
from src.kyc.config import KYCSettings, get_kyc_settings
from src.kyc.exceptions import InvalidImageError, OCRExtractionError
from src.kyc.models import FaceCompareResponse, LivenessResponse, OCRResponse
from src.kyc.ocr_service import OCRService

logger = logging.getLogger(__name__)

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png"}
BYTES_PER_MB = 1024 * 1024

router = APIRouter(prefix="/ai", tags=["kyc"], dependencies=[Depends(verify_service_token)])

# Singleton OCR service instance (lazily initialized on first use)
_ocr_service: OCRService | None = None


def get_ocr_service(settings: KYCSettings = Depends(get_kyc_settings)) -> OCRService:
    """Provide a singleton OCR service instance.

    Args:
        settings: KYC configuration from environment.

    Returns:
        Configured OCRService instance.
    """
    global _ocr_service  # noqa: PLW0603
    if _ocr_service is None:
        _ocr_service = OCRService(settings=settings)
    return _ocr_service


@router.post(
    "/ocr",
    summary="Extract text and face from document image",
    response_model=OCRResponse,
)
async def ocr_extract(
    file: UploadFile = File(..., description="Document image (JPEG/PNG)"),
    settings: KYCSettings = Depends(get_kyc_settings),
    ocr_service: OCRService = Depends(get_ocr_service),
) -> OCRResponse:
    """Extract text fields and detect face in an identity document.

    Validates file type and size, extracts text via PaddleOCR,
    detects and crops the face for downstream comparison.

    Args:
        file: Uploaded document image.
        settings: KYC configuration settings.
        ocr_service: Injected OCR service.

    Returns:
        Extracted fields with confidence score and face detection flag.

    Raises:
        HTTPException: 400 for invalid file type/size, 422 for extraction failure.
    """
    _validate_file_type(file)
    image_bytes = await _read_and_validate_size(file, settings)

    try:
        image = ocr_service.decode_image(image_bytes)
    except InvalidImageError as exc:
        logger.warning("Invalid image uploaded: %s", exc.message)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=exc.message,
        ) from exc

    try:
        ocr_result = ocr_service.extract_text(image)
    except OCRExtractionError as exc:
        logger.warning("OCR extraction failed: %s", exc.message)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.message,
        ) from exc

    face_detected, face_image = ocr_service.detect_face(image)

    logger.info(
        "OCR completed — confidence=%.4f, face_detected=%s",
        ocr_result.overall_confidence,
        face_detected,
    )

    return OCRResponse(
        extracted_name=ocr_result.extracted_name,
        document_number=ocr_result.document_number,
        expiry_date=ocr_result.expiry_date,
        date_of_birth=ocr_result.date_of_birth,
        nationality=ocr_result.nationality,
        document_type=ocr_result.document_type,
        confidence=ocr_result.overall_confidence,
        field_confidences=ocr_result.field_confidences,
        face_detected=face_detected,
        face_image=face_image,
    )


def _validate_file_type(file: UploadFile) -> None:
    """Validate uploaded file has an allowed content type.

    Args:
        file: The uploaded file to validate.

    Raises:
        HTTPException: 400 if content type is not JPEG or PNG.
    """
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type: {file.content_type}. Accepted: JPEG, PNG",
        )


async def _read_and_validate_size(file: UploadFile, settings: KYCSettings) -> bytes:
    """Read file bytes and validate against max size.

    Args:
        file: The uploaded file.
        settings: KYC settings with max file size configuration.

    Returns:
        Raw file bytes.

    Raises:
        HTTPException: 400 if file exceeds max size.
    """
    image_bytes = await file.read()
    max_bytes = settings.kyc_max_file_size_mb * BYTES_PER_MB
    if len(image_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum: {settings.kyc_max_file_size_mb}MB",
        )
    return image_bytes


@router.post(
    "/face-compare",
    summary="Compare two face images",
    response_model=FaceCompareResponse,
)
async def face_compare(
    document_face: UploadFile = File(..., description="Face extracted from document"),
    selfie: UploadFile = File(..., description="Selfie image for comparison"),
) -> FaceCompareResponse:
    """Compare a document face against a selfie and return similarity.

    Args:
        document_face: Face image from the identity document.
        selfie: Selfie image taken by the user.

    Returns:
        Similarity score and match determination.
    """
    # Stub — full implementation in Task 20
    return FaceCompareResponse(similarity_score=0.0, is_match=False)


@router.post(
    "/liveness",
    summary="Detect liveness in selfie image",
    response_model=LivenessResponse,
)
async def liveness_check(
    file: UploadFile = File(..., description="Selfie image for liveness detection"),
) -> LivenessResponse:
    """Detect whether a selfie image is a live person or a spoof.

    Args:
        file: Selfie image to analyze.

    Returns:
        Liveness score and determination.
    """
    # Stub — full implementation in Task 21
    return LivenessResponse(liveness_score=0.0, is_live=False)
