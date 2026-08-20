"""Tests for the KYC router, auth middleware, and X-Request-ID propagation."""

import io
from typing import Any
from unittest.mock import patch

from fastapi.testclient import TestClient

from src.kyc.config import KYCSettings, get_kyc_settings
from src.main import app

TEST_AUTH_TOKEN = "test-secret-token-for-testing"


def _override_settings() -> KYCSettings:
    """Provide test settings with a known auth token."""
    return KYCSettings(ai_service_auth_token=TEST_AUTH_TOKEN)


app.dependency_overrides[get_kyc_settings] = _override_settings
client: TestClient = TestClient(app)


def _auth_header() -> dict[str, str]:
    """Return a valid Authorization header for tests."""
    return {"Authorization": f"Bearer {TEST_AUTH_TOKEN}"}


def _fake_file(name: str = "test.jpg") -> tuple[str, tuple[str, io.BytesIO, str]]:
    """Create a minimal fake file for upload tests."""
    return (name, (name, io.BytesIO(b"fake-image-data"), "image/jpeg"))


# --- Auth Middleware Tests ---


class TestAuthMiddleware:
    """Tests for the service-to-service auth dependency."""

    def test_missing_auth_header_returns_401(self) -> None:
        """Request without Authorization header is rejected."""
        response = client.post("/ai/ocr", files=[_fake_file("file")])

        assert response.status_code == 401
        assert "Missing Authorization header" in response.json()["detail"]

    def test_invalid_token_returns_401(self) -> None:
        """Request with wrong token is rejected."""
        response = client.post(
            "/ai/ocr",
            headers={"Authorization": "Bearer wrong-token"},
            files=[_fake_file("file")],
        )

        assert response.status_code == 401
        assert "Invalid authentication token" in response.json()["detail"]

    def test_malformed_auth_header_returns_401(self) -> None:
        """Request with malformed Authorization header is rejected."""
        response = client.post(
            "/ai/ocr",
            headers={"Authorization": "NotBearer some-token"},
            files=[_fake_file("file")],
        )

        assert response.status_code == 401

    def test_valid_token_accepts_request(self) -> None:
        """Request with correct token is accepted."""
        response = client.post(
            "/ai/ocr",
            headers=_auth_header(),
            files=[_fake_file("file")],
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
            files=[_fake_file("file")],
        )

        assert response.headers["X-Request-ID"] == request_id

    def test_request_id_generated_when_missing(self) -> None:
        """X-Request-ID is generated when not provided in the request."""
        response = client.post(
            "/ai/ocr",
            headers=_auth_header(),
            files=[_fake_file("file")],
        )

        assert "X-Request-ID" in response.headers
        assert len(response.headers["X-Request-ID"]) > 0


# --- Endpoint Stub Tests ---


class TestOCREndpoint:
    """Tests for the /ai/ocr endpoint stub."""

    def test_ocr_returns_expected_structure(self) -> None:
        """OCR endpoint returns the correct response schema."""
        response = client.post(
            "/ai/ocr",
            headers=_auth_header(),
            files=[_fake_file("file")],
        )

        data: dict[str, Any] = response.json()
        assert response.status_code == 200
        assert "extracted_name" in data
        assert "document_number" in data
        assert "confidence" in data
        assert "face_detected" in data
        assert isinstance(data["confidence"], float)
        assert isinstance(data["face_detected"], bool)


class TestFaceCompareEndpoint:
    """Tests for the /ai/face-compare endpoint stub."""

    def test_face_compare_returns_expected_structure(self) -> None:
        """Face compare endpoint returns the correct response schema."""
        response = client.post(
            "/ai/face-compare",
            headers=_auth_header(),
            files=[_fake_file("document_face"), _fake_file("selfie")],
        )

        data: dict[str, Any] = response.json()
        assert response.status_code == 200
        assert "similarity_score" in data
        assert "is_match" in data
        assert isinstance(data["similarity_score"], float)
        assert isinstance(data["is_match"], bool)


class TestLivenessEndpoint:
    """Tests for the /ai/liveness endpoint stub."""

    def test_liveness_returns_expected_structure(self) -> None:
        """Liveness endpoint returns the correct response schema."""
        response = client.post(
            "/ai/liveness",
            headers=_auth_header(),
            files=[_fake_file("file")],
        )

        data: dict[str, Any] = response.json()
        assert response.status_code == 200
        assert "liveness_score" in data
        assert "is_live" in data
        assert isinstance(data["liveness_score"], float)
        assert isinstance(data["is_live"], bool)
