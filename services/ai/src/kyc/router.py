"""KYC router — API endpoints for identity verification.

Provides OCR, face comparison, and liveness detection endpoints.
All routes require service-to-service Bearer token authentication.
"""

from fastapi import APIRouter, Depends, File, UploadFile

from src.kyc.auth import verify_service_token
from src.kyc.models import FaceCompareResponse, LivenessResponse, OCRResponse

router = APIRouter(prefix="/ai", tags=["kyc"], dependencies=[Depends(verify_service_token)])


@router.post(
    "/ocr",
    summary="Extract text and face from document image",
    response_model=OCRResponse,
)
async def ocr_extract(
    file: UploadFile = File(..., description="Document image (JPEG/PNG)"),
) -> OCRResponse:
    """Extract text fields and detect face in an identity document.

    Args:
        file: Uploaded document image.

    Returns:
        Extracted fields with confidence score and face detection flag.
    """
    # Stub — full implementation in Task 19
    return OCRResponse(
        extracted_name="",
        document_number="",
        expiry_date=None,
        document_type="",
        confidence=0.0,
        face_detected=False,
    )


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
