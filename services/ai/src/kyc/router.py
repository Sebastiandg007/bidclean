"""KYC router — API endpoints for identity verification.

Provides OCR, face comparison, and liveness detection endpoints.
All routes require service-to-service Bearer token authentication.
"""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from src.kyc.auth import verify_service_token
from src.kyc.config import KYCSettings, get_kyc_settings
from src.kyc.exceptions import (
    FaceComparisonError,
    FaceExtractionError,
    InvalidImageError,
    LivenessDetectionError,
    MultipleFacesError,
    NoFaceInSelfieError,
    OCRExtractionError,
)
from src.kyc.face_compare_service import FaceCompareService
from src.kyc.liveness_service import LivenessService
from src.kyc.models import FaceCompareResponse, LivenessResponse, OCRResponse
from src.kyc.ocr_service import OCRService

logger = logging.getLogger(__name__)

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png"}
BYTES_PER_MB = 1024 * 1024

router = APIRouter(prefix="/ai", tags=["kyc"], dependencies=[Depends(verify_service_token)])

# Singleton service instances (lazily initialized on first use)
_ocr_service: OCRService | None = None
_face_compare_service: FaceCompareService | None = None
_liveness_service: LivenessService | None = None


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


def get_face_compare_service(
    settings: KYCSettings = Depends(get_kyc_settings),
) -> FaceCompareService:
    """Provide a singleton FaceCompareService instance.

    Args:
        settings: KYC configuration from environment.

    Returns:
        Configured FaceCompareService instance.
    """
    global _face_compare_service  # noqa: PLW0603
    if _face_compare_service is None:
        _face_compare_service = FaceCompareService(settings=settings)
    return _face_compare_service


def get_liveness_service(
    settings: KYCSettings = Depends(get_kyc_settings),
) -> LivenessService:
    """Provide a singleton LivenessService instance.

    Args:
        settings: KYC configuration from environment.

    Returns:
        Configured LivenessService instance.
    """
    global _liveness_service  # noqa: PLW0603
    if _liveness_service is None:
        _liveness_service = LivenessService(settings=settings)
    return _liveness_service


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
    settings: KYCSettings = Depends(get_kyc_settings),
    face_service: FaceCompareService = Depends(get_face_compare_service),
) -> FaceCompareResponse:
    """Compare a document face against a selfie and return similarity.

    Validates file types and sizes, extracts face embeddings via DeepFace,
    calculates cosine similarity, and determines match against threshold.
    Face embeddings are NEVER stored — only used in memory during comparison.

    Args:
        document_face: Face image from the identity document.
        selfie: Selfie image taken by the user.
        settings: KYC configuration settings.
        face_service: Injected face comparison service.

    Returns:
        Similarity score and match determination.

    Raises:
        HTTPException: 400 for invalid files, 422 for face detection failures.
    """
    _validate_file_type(document_face)
    _validate_file_type(selfie)

    doc_bytes = await _read_and_validate_size(document_face, settings)
    selfie_bytes = await _read_and_validate_size(selfie, settings)

    try:
        doc_image = face_service.decode_image(doc_bytes)
    except InvalidImageError as exc:
        logger.warning("Invalid document face image: %s", exc.message)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=exc.message,
        ) from exc

    try:
        selfie_image = face_service.decode_image(selfie_bytes)
    except InvalidImageError as exc:
        logger.warning("Invalid selfie image: %s", exc.message)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=exc.message,
        ) from exc

    try:
        result = face_service.compare_faces(doc_image, selfie_image)
    except (NoFaceInSelfieError, MultipleFacesError, FaceExtractionError) as exc:
        logger.warning("Face comparison failed: %s", exc.message)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.message,
        ) from exc
    except FaceComparisonError as exc:
        logger.error("Unexpected face comparison error: %s", exc.message)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.message,
        ) from exc

    return FaceCompareResponse(
        similarity_score=result.similarity_score,
        is_match=result.is_match,
    )


@router.post(
    "/liveness",
    summary="Detect liveness in selfie image",
    response_model=LivenessResponse,
)
async def liveness_check(
    file: UploadFile = File(..., description="Selfie image for liveness detection"),
    settings: KYCSettings = Depends(get_kyc_settings),
    liveness_service: LivenessService = Depends(get_liveness_service),
) -> LivenessResponse:
    """Detect whether a selfie image is a live person or a spoof.

    Validates file type and size, decodes image, runs anti-spoofing
    prediction via Silent-Face-Anti-Spoofing, and evaluates the score
    against the configured liveness threshold.
    No biometric data is stored — only a score is returned.

    Args:
        file: Selfie image to analyze.
        settings: KYC configuration settings.
        liveness_service: Injected liveness detection service.

    Returns:
        Liveness score and determination.

    Raises:
        HTTPException: 400 for invalid file type/size, 422 for detection failure.
    """
    _validate_file_type(file)
    image_bytes = await _read_and_validate_size(file, settings)

    try:
        image = liveness_service.decode_image(image_bytes)
    except InvalidImageError as exc:
        logger.warning("Invalid image for liveness: %s", exc.message)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=exc.message,
        ) from exc

    try:
        result = liveness_service.detect_liveness(image)
    except NoFaceInSelfieError as exc:
        logger.warning("No face for liveness detection: %s", exc.message)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.message,
        ) from exc
    except LivenessDetectionError as exc:
        logger.warning("Liveness detection failed: %s", exc.message)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.message,
        ) from exc

    return LivenessResponse(
        liveness_score=result.liveness_score,
        is_live=result.is_live,
    )
