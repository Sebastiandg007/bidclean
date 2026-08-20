"""Tests for the FaceCompareService in isolation (mocking DeepFace)."""

import numpy as np
import pytest

from src.kyc.config import KYCSettings
from src.kyc.exceptions import (
    FaceExtractionError,
    InvalidImageError,
    MultipleFacesError,
    NoFaceInSelfieError,
)
from src.kyc.face_compare_service import FaceCompareService


def _test_settings(threshold: float = 0.6) -> KYCSettings:
    """Create test settings with configurable threshold."""
    return KYCSettings(
        ai_service_auth_token="test-token",
        kyc_face_similarity_threshold=threshold,
    )


def _mock_engine_with_responses(
    doc_response: list[dict] | Exception,
    selfie_response: list[dict] | Exception,
) -> "MockFaceEngine":
    """Create a mock engine that returns different results per call.

    First call returns doc_response, second call returns selfie_response.
    """

    class MockFaceEngine:
        def __init__(self) -> None:
            self.call_count = 0
            self.calls: list[dict] = []

        def represent(
            self,
            img_path: np.ndarray,
            model_name: str,
            enforce_detection: bool,
            detector_backend: str,
        ) -> list[dict]:
            self.call_count += 1
            self.calls.append({
                "img_path_shape": img_path.shape,
                "model_name": model_name,
                "enforce_detection": enforce_detection,
            })
            response = doc_response if self.call_count == 1 else selfie_response
            if isinstance(response, Exception):
                raise response
            return response

    return MockFaceEngine()


def _generate_embedding(seed: int = 42, dim: int = 128) -> list[float]:
    """Generate a deterministic embedding vector for testing."""
    rng = np.random.default_rng(seed)
    vec = rng.random(dim)
    # Normalize to unit vector
    return (vec / np.linalg.norm(vec)).tolist()


def _fake_image(height: int = 300, width: int = 200) -> np.ndarray:
    """Create a fake BGR image for testing."""
    return np.zeros((height, width, 3), dtype=np.uint8)


class TestFaceCompareServiceMatchAboveThreshold:
    """Test valid comparison where faces match above threshold."""

    def test_identical_embeddings_return_match(self) -> None:
        """Identical embeddings produce similarity 1.0 and is_match=True."""
        embedding = _generate_embedding(seed=1)
        engine = _mock_engine_with_responses(
            [{"embedding": embedding}],
            [{"embedding": embedding}],
        )
        service = FaceCompareService(settings=_test_settings(threshold=0.6), engine=engine)

        result = service.compare_faces(_fake_image(), _fake_image())

        assert result.similarity_score == pytest.approx(1.0, abs=0.001)
        assert result.is_match is True

    def test_similar_embeddings_above_threshold(self) -> None:
        """Similar embeddings above threshold return is_match=True."""
        embedding_a = _generate_embedding(seed=10)
        # Slight perturbation to create similar but not identical embedding
        embedding_b = embedding_a.copy()
        embedding_b[0] += 0.01
        # Renormalize
        vec = np.array(embedding_b)
        embedding_b = (vec / np.linalg.norm(vec)).tolist()

        engine = _mock_engine_with_responses(
            [{"embedding": embedding_a}],
            [{"embedding": embedding_b}],
        )
        service = FaceCompareService(settings=_test_settings(threshold=0.6), engine=engine)

        result = service.compare_faces(_fake_image(), _fake_image())

        assert result.similarity_score > 0.6
        assert result.is_match is True


class TestFaceCompareServiceBelowThreshold:
    """Test valid comparison where faces don't match (below threshold)."""

    def test_orthogonal_embeddings_return_no_match(self) -> None:
        """Very different embeddings produce low similarity and is_match=False."""
        embedding_a = _generate_embedding(seed=100)
        embedding_b = _generate_embedding(seed=999)

        engine = _mock_engine_with_responses(
            [{"embedding": embedding_a}],
            [{"embedding": embedding_b}],
        )
        service = FaceCompareService(settings=_test_settings(threshold=0.9), engine=engine)

        result = service.compare_faces(_fake_image(), _fake_image())

        assert result.similarity_score < 0.9
        assert result.is_match is False

    def test_threshold_boundary_below(self) -> None:
        """Score exactly below threshold returns is_match=False."""
        embedding = _generate_embedding(seed=1)
        # Create embedding with known low similarity
        opposite = [-x for x in embedding]

        engine = _mock_engine_with_responses(
            [{"embedding": embedding}],
            [{"embedding": opposite}],
        )
        service = FaceCompareService(settings=_test_settings(threshold=0.6), engine=engine)

        result = service.compare_faces(_fake_image(), _fake_image())

        assert result.is_match is False


class TestNoFaceInDocumentImage:
    """Test when no face is detected in the document image."""

    def test_no_face_in_document_raises_extraction_error(self) -> None:
        """FaceExtractionError raised when DeepFace finds no face in document."""
        engine = _mock_engine_with_responses(
            ValueError("Face could not be detected"),
            [{"embedding": _generate_embedding()}],
        )
        service = FaceCompareService(settings=_test_settings(), engine=engine)

        with pytest.raises(FaceExtractionError, match="No face detected in document"):
            service.compare_faces(_fake_image(), _fake_image())

    def test_empty_representation_list_raises_extraction_error(self) -> None:
        """FaceExtractionError raised when DeepFace returns empty list for document."""
        engine = _mock_engine_with_responses(
            [],
            [{"embedding": _generate_embedding()}],
        )
        service = FaceCompareService(settings=_test_settings(), engine=engine)

        with pytest.raises(FaceExtractionError):
            service.compare_faces(_fake_image(), _fake_image())


class TestNoFaceInSelfie:
    """Test when no face is detected in the selfie."""

    def test_no_face_in_selfie_raises_error(self) -> None:
        """NoFaceInSelfieError raised when DeepFace finds no face in selfie."""
        engine = _mock_engine_with_responses(
            [{"embedding": _generate_embedding()}],
            ValueError("Face could not be detected in selfie"),
        )
        service = FaceCompareService(settings=_test_settings(), engine=engine)

        with pytest.raises(NoFaceInSelfieError):
            service.compare_faces(_fake_image(), _fake_image())

    def test_empty_selfie_representation_raises_error(self) -> None:
        """NoFaceInSelfieError raised when DeepFace returns empty list for selfie."""
        engine = _mock_engine_with_responses(
            [{"embedding": _generate_embedding()}],
            [],
        )
        service = FaceCompareService(settings=_test_settings(), engine=engine)

        with pytest.raises(NoFaceInSelfieError):
            service.compare_faces(_fake_image(), _fake_image())


class TestMultipleFacesInSelfie:
    """Test when multiple faces are detected in the selfie (should reject)."""

    def test_multiple_faces_in_selfie_raises_error(self) -> None:
        """MultipleFacesError raised when selfie contains more than one face."""
        engine = _mock_engine_with_responses(
            [{"embedding": _generate_embedding(seed=1)}],
            [
                {"embedding": _generate_embedding(seed=2)},
                {"embedding": _generate_embedding(seed=3)},
            ],
        )
        service = FaceCompareService(settings=_test_settings(), engine=engine)

        with pytest.raises(MultipleFacesError, match="Multiple faces"):
            service.compare_faces(_fake_image(), _fake_image())


class TestInvalidImageHandling:
    """Test invalid image handling in decode_image."""

    def test_empty_bytes_raises_invalid_image(self) -> None:
        """Empty bytes input raises InvalidImageError."""
        service = FaceCompareService(settings=_test_settings())

        with pytest.raises(InvalidImageError, match="Could not decode"):
            service.decode_image(b"")

    def test_garbage_bytes_raises_invalid_image(self) -> None:
        """Non-image bytes raise InvalidImageError."""
        service = FaceCompareService(settings=_test_settings())

        with pytest.raises(InvalidImageError, match="Could not decode"):
            service.decode_image(b"not-an-image-at-all")

    def test_valid_image_decodes_successfully(self) -> None:
        """Valid image bytes decode to numpy array."""
        import cv2

        # Create a real small image in memory
        img = np.zeros((50, 50, 3), dtype=np.uint8)
        _, buffer = cv2.imencode(".jpg", img)
        image_bytes = buffer.tobytes()

        service = FaceCompareService(settings=_test_settings())
        result = service.decode_image(image_bytes)

        assert isinstance(result, np.ndarray)
        assert len(result.shape) == 3


class TestEmbeddingsNotStored:
    """Test that embeddings are not persisted (no storage side effects)."""

    def test_service_has_no_embedding_storage(self) -> None:
        """FaceCompareService has no attribute for storing embeddings."""
        service = FaceCompareService(settings=_test_settings())

        # Verify no embedding-related storage attributes exist
        attrs = dir(service)
        storage_attrs = [a for a in attrs if "embedding" in a.lower() and not a.startswith("_")]
        assert storage_attrs == []

    def test_comparison_leaves_no_state(self) -> None:
        """After comparison, no embeddings remain accessible on the service."""
        embedding = _generate_embedding(seed=42)
        engine = _mock_engine_with_responses(
            [{"embedding": embedding}],
            [{"embedding": embedding}],
        )
        service = FaceCompareService(settings=_test_settings(), engine=engine)

        service.compare_faces(_fake_image(), _fake_image())

        # Service should not retain any embedding data
        instance_vars = vars(service)
        for key, value in instance_vars.items():
            if key == "_engine" or key == "_settings":
                continue
            # No new instance attributes should exist after comparison
            assert "embedding" not in key.lower()


class TestCosineSimilarityEdgeCases:
    """Test cosine similarity calculation edge cases."""

    def test_zero_vector_returns_zero_similarity(self) -> None:
        """Zero-norm vector returns 0.0 similarity."""
        zero_embedding = [0.0] * 128
        valid_embedding = _generate_embedding(seed=1)

        engine = _mock_engine_with_responses(
            [{"embedding": zero_embedding}],
            [{"embedding": valid_embedding}],
        )
        service = FaceCompareService(settings=_test_settings(), engine=engine)

        result = service.compare_faces(_fake_image(), _fake_image())

        assert result.similarity_score == 0.0
        assert result.is_match is False

    def test_similarity_clamped_to_unit_range(self) -> None:
        """Similarity score is always between 0.0 and 1.0."""
        embedding = _generate_embedding(seed=5)
        engine = _mock_engine_with_responses(
            [{"embedding": embedding}],
            [{"embedding": embedding}],
        )
        service = FaceCompareService(settings=_test_settings(), engine=engine)

        result = service.compare_faces(_fake_image(), _fake_image())

        assert 0.0 <= result.similarity_score <= 1.0
