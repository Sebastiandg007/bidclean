"""Video-verification router — the on-arrival face-comparison endpoint.

Exposes ``POST /verify-face`` which accepts the candidate arrival-video bytes + the reference KYC
selfie bytes via multipart (Option A — no storage reference, no MinIO credentials) and returns
``{ score, decision }``. Service-to-service auth reuses the shared Bearer token dependency. The
FaceVerifyService is provided via a FastAPI dependency so it can be overridden in tests with a stub.
"""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from src.kyc.auth import verify_service_token
from src.video_verification.config import (
    VideoVerificationSettings,
    get_video_verification_settings,
)
from src.video_verification.exceptions import InvalidMediaError
from src.video_verification.face_verify_service import FaceVerifyService
from src.video_verification.models import VerifyFaceResponse

logger = logging.getLogger(__name__)

BYTES_PER_MB = 1024 * 1024

router = APIRouter(prefix="/verify-face", tags=["video-verification"])

# Singleton service instance (lazily initialized on first use).
_face_verify_service: FaceVerifyService | None = None


def get_face_verify_service(
    settings: VideoVerificationSettings = Depends(get_video_verification_settings),
) -> FaceVerifyService:
    """Provide a singleton FaceVerifyService instance.

    Args:
        settings: Video-verification configuration from environment.

    Returns:
        Configured FaceVerifyService instance.
    """
    global _face_verify_service  # noqa: PLW0603
    if _face_verify_service is None:
        _face_verify_service = FaceVerifyService(settings=settings)
    return _face_verify_service


@router.post("", response_model=VerifyFaceResponse, status_code=status.HTTP_200_OK)
async def verify_face(
    candidate: UploadFile = File(..., description="Arrival video (bytes)"),
    reference: UploadFile = File(..., description="Reference KYC selfie (bytes)"),
    _request_id: str | None = Depends(verify_service_token),
    settings: VideoVerificationSettings = Depends(get_video_verification_settings),
    service: FaceVerifyService = Depends(get_face_verify_service),
) -> VerifyFaceResponse:
    """Compare an arrival-video face against a reference selfie.

    Reads both multipart payloads (bytes only; no storage reference), enforces the size bound, and
    runs the DeepFace comparison. A missing/undetectable face yields an INCONCLUSIVE decision (a
    non-fatal advisory outcome). Face embeddings are never persisted.

    Args:
        candidate: The arrival video (or representative frame) bytes.
        reference: The reference KYC selfie bytes.
        _request_id: Correlation id from the authenticated caller.
        settings: Video-verification configuration.
        service: The injected face-verify service.

    Returns:
        The similarity score and advisory decision.

    Raises:
        HTTPException: 413 when a payload is too large; 422 when the media is undecodable.
    """
    candidate_bytes = await _read_within_limit(candidate, settings)
    reference_bytes = await _read_within_limit(reference, settings)

    try:
        return service.verify(candidate_bytes, reference_bytes)
    except InvalidMediaError as exc:
        logger.warning("Verify-face media invalid: %s", exc.message)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.message,
        ) from exc


async def _read_within_limit(
    file: UploadFile,
    settings: VideoVerificationSettings,
) -> bytes:
    """Read an uploaded file's bytes and enforce the configured maximum size.

    Args:
        file: The uploaded multipart file.
        settings: Video-verification settings with the max size bound.

    Returns:
        The raw bytes.

    Raises:
        HTTPException: 413 if the payload exceeds the maximum size.
    """
    data = await file.read()
    max_bytes = settings.video_verification_max_file_size_mb * BYTES_PER_MB
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Media too large. Maximum: {settings.video_verification_max_file_size_mb}MB",
        )
    return data
