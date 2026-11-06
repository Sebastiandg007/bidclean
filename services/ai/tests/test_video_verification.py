"""Tests for the video-verification face-verify service and endpoint.

Covers the DeepFace-backed comparison on representative embedding pairs (match / non-match /
no-face → INCONCLUSIVE), score range, in-memory-only embeddings, the absence of any MinIO client in
the module, and the ``/verify-face`` endpoint (auth + decision shape + correlation id).

IMPORTANT: the endpoint tests register FastAPI dependency overrides inside a fixture that ALWAYS
restores them on teardown, so the shared `app` is never left contaminated for the KYC/speech suites.
"""

import io
from collections.abc import Iterator
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

import src.video_verification.face_verify_service as service_module
from src.video_verification.config import VideoVerificationSettings
from src.video_verification.face_verify_service import FaceVerifyService
from src.video_verification.models import VerifyFaceResponse

TEST_AUTH_TOKEN = "test-secret-token-for-testing"


class _StubEngine:
    """Deterministic embedding engine keyed by the frame's first pixel value.

    Returns a fixed embedding per "identity" so cosine similarity is predictable, or an empty list
    to simulate a no-face image.
    """

    def __init__(self, embeddings_by_marker: dict[int, list[float]]) -> None:
        self._by_marker = embeddings_by_marker

    def represent(
        self,
        img_path: np.ndarray,
        model_name: str,  # noqa: ARG002 — protocol parity
        enforce_detection: bool,  # noqa: ARG002 — protocol parity
        detector_backend: str,  # noqa: ARG002 — protocol parity
    ) -> list[dict[str, Any]]:
        marker = int(img_path.flat[0])
        embedding = self._by_marker.get(marker)
        if embedding is None:
            return []
        return [{"embedding": embedding}]


class _StubFrameExtractor:
    """Frame extractor that maps candidate bytes to a marked 1x1 image (no native decoder)."""

    def extract_frame(self, video_bytes: bytes) -> np.ndarray:
        marker = video_bytes[0] if video_bytes else 0
        return np.full((1, 1, 3), marker, dtype=np.uint8)


def _settings() -> VideoVerificationSettings:
    """Test settings with a known auth token and a mid threshold."""
    return VideoVerificationSettings(
        ai_service_auth_token=TEST_AUTH_TOKEN,
        video_verification_similarity_threshold=0.6,
    )


def _decode_marker(reference_bytes: bytes) -> np.ndarray:
    """Deterministically map reference bytes to a marked image (bypasses cv2 in service tests)."""
    marker = reference_bytes[0] if reference_bytes else 0
    return np.full((1, 1, 3), marker, dtype=np.uint8)


def _build_service(embeddings: dict[int, list[float]]) -> FaceVerifyService:
    """Build a FaceVerifyService with a stubbed engine + frame extractor and a patched decoder."""
    svc = FaceVerifyService(
        settings=_settings(),
        engine=_StubEngine(embeddings),
        frame_extractor=_StubFrameExtractor(),
    )
    # Patch the reference decoder so no real cv2 decode is needed in the service unit tests.
    svc._decode_reference = _decode_marker  # type: ignore[assignment]  # noqa: SLF001
    return svc


class TestFaceVerifyService:
    """Unit tests for the DeepFace-backed comparison logic."""

    def test_identical_embeddings_yield_match(self) -> None:
        """A high similarity (same embedding) is a MATCH with score in [0, 1]."""
        svc = _build_service({1: [1.0, 0.0, 0.0]})
        result = svc.verify(bytes([1]), bytes([1]))
        assert result.decision == "MATCH"
        assert 0.0 <= result.score <= 1.0
        assert result.score == pytest.approx(1.0)

    def test_orthogonal_embeddings_yield_no_match(self) -> None:
        """Orthogonal embeddings (similarity 0) fall below threshold → NO_MATCH."""
        svc = _build_service({1: [1.0, 0.0, 0.0], 2: [0.0, 1.0, 0.0]})
        result = svc.verify(bytes([1]), bytes([2]))
        assert result.decision == "NO_MATCH"
        assert 0.0 <= result.score <= 1.0

    def test_no_face_yields_inconclusive(self) -> None:
        """A frame with no detectable face yields INCONCLUSIVE (non-fatal), not an error."""
        svc = _build_service({1: [1.0, 0.0, 0.0]})  # marker 9 has no embedding → no face
        result = svc.verify(bytes([9]), bytes([1]))
        assert result.decision == "INCONCLUSIVE"
        assert result.score == 0.0

    def test_response_is_typed_model(self) -> None:
        """The service returns a validated VerifyFaceResponse."""
        svc = _build_service({1: [1.0, 0.0, 0.0]})
        result = svc.verify(bytes([1]), bytes([1]))
        assert isinstance(result, VerifyFaceResponse)


def test_module_has_no_minio_client() -> None:
    """Option A: the video_verification service module imports no MinIO/storage client.

    Checks actual import statements (not prose), so a docstring mentioning "no MinIO access" does
    not trip the assertion.
    """
    with open(service_module.__file__, encoding="utf-8") as handle:
        import_lines = [
            line.strip()
            for line in handle.read().splitlines()
            if line.strip().startswith(("import ", "from "))
        ]
    lowered = [line.lower() for line in import_lines]
    assert not any("minio" in line for line in lowered)
    assert not any("boto3" in line for line in lowered)


@pytest.fixture()
def client_with_stub() -> Iterator[TestClient]:
    """A TestClient whose /verify-face deps are stubbed and ALWAYS restored on teardown."""
    from src.kyc.config import get_kyc_settings
    from src.main import app
    from src.video_verification.config import get_video_verification_settings
    from src.video_verification.router import get_face_verify_service

    def _match_service() -> FaceVerifyService:
        return _build_service({1: [1.0, 0.0, 0.0]})

    app.dependency_overrides[get_video_verification_settings] = _settings
    app.dependency_overrides[get_kyc_settings] = _settings
    app.dependency_overrides[get_face_verify_service] = _match_service
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_video_verification_settings, None)
        app.dependency_overrides.pop(get_kyc_settings, None)
        app.dependency_overrides.pop(get_face_verify_service, None)


def _auth_header() -> dict[str, str]:
    """Return a valid Authorization header for tests."""
    return {"Authorization": f"Bearer {TEST_AUTH_TOKEN}"}


def _file(field: str, marker: int) -> tuple[str, tuple[str, io.BytesIO, str]]:
    """Build a multipart file part carrying a single marker byte."""
    return (field, (f"{field}.bin", io.BytesIO(bytes([marker])), "application/octet-stream"))


class TestVerifyFaceEndpoint:
    """Endpoint tests for POST /verify-face."""

    def test_requires_auth(self, client_with_stub: TestClient) -> None:
        """The endpoint rejects an unauthenticated request."""
        response = client_with_stub.post(
            "/verify-face",
            files=[_file("candidate", 1), _file("reference", 1)],
        )
        assert response.status_code == 401

    def test_returns_decision_and_score(self, client_with_stub: TestClient) -> None:
        """A valid request returns a score in [0, 1] and a decision."""
        response = client_with_stub.post(
            "/verify-face",
            headers=_auth_header(),
            files=[_file("candidate", 1), _file("reference", 1)],
        )
        assert response.status_code == 200
        data = response.json()
        assert data["decision"] == "MATCH"
        assert 0.0 <= data["score"] <= 1.0

    def test_request_id_propagated(self, client_with_stub: TestClient) -> None:
        """The X-Request-ID correlation header is echoed back."""
        response = client_with_stub.post(
            "/verify-face",
            headers={**_auth_header(), "X-Request-ID": "corr-123"},
            files=[_file("candidate", 1), _file("reference", 1)],
        )
        assert response.headers["X-Request-ID"] == "corr-123"
