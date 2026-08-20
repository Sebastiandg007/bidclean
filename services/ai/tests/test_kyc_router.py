"""Tests for the KYC router, auth middleware, and OCR endpoint."""

import io
from typing import Any
from unittest.mock import MagicMock

import numpy as np
from fastapi.testclient import TestClient

from src.kyc.config import KYCSettings, get_kyc_settings
from src.kyc.exceptions import (
    FaceExtractionError,
    InvalidImageError,
    MultipleFacesError,
    NoFaceInSelfieError,
    OCRExtractionError,
)
from src.kyc.face_compare_service import FaceCompareResult, FaceCompareService
from src.kyc.ocr_service import OCRResult, OCRService
from src.kyc.router import get_face_compare_service, get_ocr_service
from src.main import app

TEST_AUTH_TOKEN = "test-secret-token-for-testing"


def _override_settings() -> KYCSettings:
    """Provide test settings with a known auth token."""
    return KYCSettings(ai_service_auth_token=TEST_AUTH_TOKEN)


def _mock_ocr_service() -> OCRService:
    """Provide a mock OCR service for endpoint tests."""
    service = MagicMock(spec=OCRService)

    # Default: successful extraction
    ocr_result = OCRResult()
    ocr_result.extracted_name = "John Smith"
    ocr_result.document_number = "AB1234567"
    ocr_result.expiry_date = "01/12/2030"
    ocr_result.date_of_birth = "15/03/1990"
    ocr_result.nationality = "Colombian"
    ocr_result.document_type = "passport"
    ocr_result.field_confidences = {
        "extracted_name": 0.92,
        "document_number": 0.88,
        "expiry_date": 0.90,
    }
    ocr_result.overall_confidence = 0.9

    service.decode_image.return_value = np.zeros((300, 200, 3), dtype=np.uint8)
    service.extract_text.return_value = ocr_result
    service.detect_face.return_value = (True, "base64encodedface==")
    return service


def _mock_face_compare_service() -> FaceCompareService:
    """Provide a mock face comparison service for endpoint tests."""
    service = MagicMock(spec=FaceCompareService)

    # Default: successful comparison with match
    service.decode_image.return_value = np.zeros((300, 200, 3), dtype=np.uint8)
    service.compare_faces.return_value = FaceCompareResult(
        similarity_score=0.85, is_match=True
    )
    return service


app.dependency_overrides[get_kyc_settings] = _override_settings
app.dependency_overrides[get_ocr_service] = _mock_ocr_service
app.dependency_overrides[get_face_compare_service] = _mock_face_compare_service
client: TestClient = TestClient(app)


def _auth_header() -> dict[str, str]:
    """Return a valid Authorization header for tests."""
    return {"Authorization": f"Bearer {TEST_AUTH_TOKEN}"}


def _fake_jpeg_file(name: str = "test.jpg") -> tuple[str, tuple[str, io.BytesIO, str]]:
    """Create a minimal fake JPEG file for upload tests."""
    return (name, (name, io.BytesIO(b"fake-image-data"), "image/jpeg"))


def _fake_png_file(name: str = "test.png") -> tuple[str, tuple[str, io.BytesIO, str]]:
    """Create a minimal fake PNG file for upload tests."""
    return (name, (name, io.BytesIO(b"fake-image-data"), "image/png"))


def _fake_pdf_file(name: str = "test.pdf") -> tuple[str, tuple[str, io.BytesIO, str]]:
    """Create a fake PDF file (unsupported format)."""
    return (name, (name, io.BytesIO(b"fake-pdf-data"), "application/pdf"))


# --- Auth Middleware Tests ---


class TestAuthMiddleware:
    """Tests for the service-to-service auth dependency."""

    def test_missing_auth_header_returns_401(self) -> None:
        """Request without Authorization header is rejected."""
        response = client.post("/ai/ocr", files=[_fake_jpeg_file("file")])

        assert response.status_code == 401
        assert "Missing Authorization header" in response.json()["detail"]

    def test_invalid_token_returns_401(self) -> None:
        """Request with wrong token is rejected."""
        response = client.post(
            "/ai/ocr",
            headers={"Authorization": "Bearer wrong-token"},
            files=[_fake_jpeg_file("file")],
        )

        assert response.status_code == 401
        assert "Invalid authentication token" in response.json()["detail"]

    def test_malformed_auth_header_returns_401(self) -> None:
        """Request with malformed Authorization header is rejected."""
        response = client.post(
            "/ai/ocr",
            headers={"Authorization": "NotBearer some-token"},
            files=[_fake_jpeg_file("file")],
        )

        assert response.status_code == 401

    def test_valid_token_accepts_request(self) -> None:
        """Request with correct token is accepted."""
        response = client.post(
            "/ai/ocr",
            headers=_auth_header(),
            files=[_fake_jpeg_file("file")],
        )

        assert response.status_code == 200


# --- X-Request-ID Tests ---


class TestRequestIdPropagation:
    """Tests for X-Request-ID middleware."""

    def test_request_id_propagated_in_response(self) -> None:
        """X-Request-ID from the request is returned in the response."""
        request_id = "test-correlation-id-123"
        response = client.post(
            "/ai/ocr",
            headers={**_auth_header(), "X-Request-ID": request_id},
            files=[_fake_jpeg_file("file")],
        )

        assert response.headers["X-Request-ID"] == request_id

    def test_request_id_generated_when_missing(self) -> None:
        """X-Request-ID is generated when not provided in the request."""
        response = client.post(
            "/ai/ocr",
            headers=_auth_header(),
            files=[_fake_jpeg_file("file")],
        )

        assert "X-Request-ID" in response.headers
        assert len(response.headers["X-Request-ID"]) > 0


# --- OCR Endpoint Tests ---


class TestOCREndpoint:
    """Tests for the /ai/ocr endpoint."""

    def test_ocr_returns_expected_structure(self) -> None:
        """OCR endpoint returns the correct response schema."""
        response = client.post(
            "/ai/ocr",
            headers=_auth_header(),
            files=[_fake_jpeg_file("file")],
        )

        data: dict[str, Any] = response.json()
        assert response.status_code == 200
        assert "extracted_name" in data
        assert "document_number" in data
        assert "confidence" in data
        assert "face_detected" in data
        assert "face_image" in data
        assert "field_confidences" in data
        assert "date_of_birth" in data
        assert "nationality" in data

    def test_ocr_returns_extracted_fields(self) -> None:
        """OCR endpoint returns populated extracted fields."""
        response = client.post(
            "/ai/ocr",
            headers=_auth_header(),
            files=[_fake_jpeg_file("file")],
        )

        data = response.json()
        assert data["extracted_name"] == "John Smith"
        assert data["document_number"] == "AB1234567"
        assert data["expiry_date"] == "01/12/2030"
        assert data["document_type"] == "passport"
        assert data["confidence"] == 0.9
        assert data["face_detected"] is True
        assert data["face_image"] == "base64encodedface=="

    def test_ocr_rejects_unsupported_file_type(self) -> None:
        """OCR endpoint rejects non-JPEG/PNG files with 400."""
        response = client.post(
            "/ai/ocr",
            headers=_auth_header(),
            files=[_fake_pdf_file("file")],
        )

        assert response.status_code == 400
        assert "Unsupported file type" in response.json()["detail"]

    def test_ocr_accepts_png_files(self) -> None:
        """OCR endpoint accepts PNG files."""
        response = client.post(
            "/ai/ocr",
            headers=_auth_header(),
            files=[_fake_png_file("file")],
        )

        assert response.status_code == 200

    def test_ocr_returns_422_on_extraction_failure(self) -> None:
        """OCR endpoint returns 422 when text extraction fails."""
        mock_service = _mock_ocr_service()
        mock_service.extract_text.side_effect = OCRExtractionError("Cannot read document")

        app.dependency_overrides[get_ocr_service] = lambda: mock_service
        try:
            response = client.post(
                "/ai/ocr",
                headers=_auth_header(),
                files=[_fake_jpeg_file("file")],
            )
            assert response.status_code == 422
            assert "Cannot read document" in response.json()["detail"]
        finally:
            app.dependency_overrides[get_ocr_service] = _mock_ocr_service

    def test_ocr_returns_400_on_invalid_image(self) -> None:
        """OCR endpoint returns 400 when image cannot be decoded."""
        mock_service = _mock_ocr_service()
        mock_service.decode_image.side_effect = InvalidImageError("Could not decode image bytes")

        app.dependency_overrides[get_ocr_service] = lambda: mock_service
        try:
            response = client.post(
                "/ai/ocr",
                headers=_auth_header(),
                files=[_fake_jpeg_file("file")],
            )
            assert response.status_code == 400
            assert "Could not decode" in response.json()["detail"]
        finally:
            app.dependency_overrides[get_ocr_service] = _mock_ocr_service

    def test_ocr_no_face_still_succeeds(self) -> None:
        """OCR endpoint returns 200 even when no face detected."""
        mock_service = _mock_ocr_service()
        mock_service.detect_face.return_value = (False, None)

        app.dependency_overrides[get_ocr_service] = lambda: mock_service
        try:
            response = client.post(
                "/ai/ocr",
                headers=_auth_header(),
                files=[_fake_jpeg_file("file")],
            )
            assert response.status_code == 200
            data = response.json()
            assert data["face_detected"] is False
            assert data["face_image"] is None
        finally:
            app.dependency_overrides[get_ocr_service] = _mock_ocr_service

    def test_ocr_rejects_oversized_file(self) -> None:
        """OCR endpoint rejects files exceeding max size with 400."""
        # Create a file larger than default 10MB limit
        large_data = b"x" * (11 * 1024 * 1024)
        large_file = ("file", ("large.jpg", io.BytesIO(large_data), "image/jpeg"))

        response = client.post(
            "/ai/ocr",
            headers=_auth_header(),
            files=[large_file],
        )

        assert response.status_code == 400
        assert "File too large" in response.json()["detail"]


# --- Face Compare Endpoint Tests ---


class TestFaceCompareEndpoint:
    """Tests for the /ai/face-compare endpoint."""

    def test_face_compare_returns_expected_structure(self) -> None:
        """Face compare endpoint returns the correct response schema."""
        response = client.post(
            "/ai/face-compare",
            headers=_auth_header(),
            files=[_fake_jpeg_file("document_face"), _fake_jpeg_file("selfie")],
        )

        data: dict[str, Any] = response.json()
        assert response.status_code == 200
        assert "similarity_score" in data
        assert "is_match" in data
        assert isinstance(data["similarity_score"], float)
        assert isinstance(data["is_match"], bool)

    def test_face_compare_returns_match_result(self) -> None:
        """Face compare returns match when similarity exceeds threshold."""
        response = client.post(
            "/ai/face-compare",
            headers=_auth_header(),
            files=[_fake_jpeg_file("document_face"), _fake_jpeg_file("selfie")],
        )

        data = response.json()
        assert response.status_code == 200
        assert data["similarity_score"] == 0.85
        assert data["is_match"] is True

    def test_face_compare_rejects_unsupported_file_type(self) -> None:
        """Face compare rejects non-JPEG/PNG files with 400."""
        response = client.post(
            "/ai/face-compare",
            headers=_auth_header(),
            files=[_fake_pdf_file("document_face"), _fake_jpeg_file("selfie")],
        )

        assert response.status_code == 400
        assert "Unsupported file type" in response.json()["detail"]

    def test_face_compare_rejects_unsupported_selfie_type(self) -> None:
        """Face compare rejects unsupported selfie file type with 400."""
        response = client.post(
            "/ai/face-compare",
            headers=_auth_header(),
            files=[_fake_jpeg_file("document_face"), _fake_pdf_file("selfie")],
        )

        assert response.status_code == 400
        assert "Unsupported file type" in response.json()["detail"]

    def test_face_compare_accepts_png_files(self) -> None:
        """Face compare accepts PNG files."""
        response = client.post(
            "/ai/face-compare",
            headers=_auth_header(),
            files=[_fake_png_file("document_face"), _fake_png_file("selfie")],
        )

        assert response.status_code == 200

    def test_face_compare_invalid_document_image_returns_400(self) -> None:
        """Face compare returns 400 when document image cannot be decoded."""
        mock_service = _mock_face_compare_service()
        mock_service.decode_image.side_effect = InvalidImageError("Could not decode image bytes")

        app.dependency_overrides[get_face_compare_service] = lambda: mock_service
        try:
            response = client.post(
                "/ai/face-compare",
                headers=_auth_header(),
                files=[_fake_jpeg_file("document_face"), _fake_jpeg_file("selfie")],
            )
            assert response.status_code == 400
            assert "Could not decode" in response.json()["detail"]
        finally:
            app.dependency_overrides[get_face_compare_service] = _mock_face_compare_service

    def test_face_compare_no_face_in_selfie_returns_422(self) -> None:
        """Face compare returns 422 when no face detected in selfie."""
        mock_service = _mock_face_compare_service()
        mock_service.compare_faces.side_effect = NoFaceInSelfieError()

        app.dependency_overrides[get_face_compare_service] = lambda: mock_service
        try:
            response = client.post(
                "/ai/face-compare",
                headers=_auth_header(),
                files=[_fake_jpeg_file("document_face"), _fake_jpeg_file("selfie")],
            )
            assert response.status_code == 422
            assert "No face detected in selfie" in response.json()["detail"]
        finally:
            app.dependency_overrides[get_face_compare_service] = _mock_face_compare_service

    def test_face_compare_multiple_faces_returns_422(self) -> None:
        """Face compare returns 422 when multiple faces in selfie."""
        mock_service = _mock_face_compare_service()
        mock_service.compare_faces.side_effect = MultipleFacesError()

        app.dependency_overrides[get_face_compare_service] = lambda: mock_service
        try:
            response = client.post(
                "/ai/face-compare",
                headers=_auth_header(),
                files=[_fake_jpeg_file("document_face"), _fake_jpeg_file("selfie")],
            )
            assert response.status_code == 422
            assert "Multiple faces" in response.json()["detail"]
        finally:
            app.dependency_overrides[get_face_compare_service] = _mock_face_compare_service

    def test_face_compare_extraction_error_returns_422(self) -> None:
        """Face compare returns 422 when face extraction fails."""
        mock_service = _mock_face_compare_service()
        mock_service.compare_faces.side_effect = FaceExtractionError(
            "No face detected in document image"
        )

        app.dependency_overrides[get_face_compare_service] = lambda: mock_service
        try:
            response = client.post(
                "/ai/face-compare",
                headers=_auth_header(),
                files=[_fake_jpeg_file("document_face"), _fake_jpeg_file("selfie")],
            )
            assert response.status_code == 422
            assert "No face detected in document" in response.json()["detail"]
        finally:
            app.dependency_overrides[get_face_compare_service] = _mock_face_compare_service

    def test_face_compare_rejects_oversized_file(self) -> None:
        """Face compare rejects files exceeding max size with 400."""
        large_data = b"x" * (11 * 1024 * 1024)
        large_file = ("document_face", ("large.jpg", io.BytesIO(large_data), "image/jpeg"))

        response = client.post(
            "/ai/face-compare",
            headers=_auth_header(),
            files=[large_file, _fake_jpeg_file("selfie")],
        )

        assert response.status_code == 400
        assert "File too large" in response.json()["detail"]

    def test_face_compare_requires_auth(self) -> None:
        """Face compare endpoint requires authentication."""
        response = client.post(
            "/ai/face-compare",
            files=[_fake_jpeg_file("document_face"), _fake_jpeg_file("selfie")],
        )

        assert response.status_code == 401


# --- Liveness Endpoint Tests ---


class TestLivenessEndpoint:
    """Tests for the /ai/liveness endpoint stub."""

    def test_liveness_returns_expected_structure(self) -> None:
        """Liveness endpoint returns the correct response schema."""
        response = client.post(
            "/ai/liveness",
            headers=_auth_header(),
            files=[_fake_jpeg_file("file")],
        )

        data: dict[str, Any] = response.json()
        assert response.status_code == 200
        assert "liveness_score" in data
        assert "is_live" in data
        assert isinstance(data["liveness_score"], float)
        assert isinstance(data["is_live"], bool)
