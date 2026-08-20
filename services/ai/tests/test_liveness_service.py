"""Tests for the LivenessService in isolation (mocking anti-spoofing engine)."""

from typing import Any

import numpy as np
import pytest

from src.kyc.config import KYCSettings
from src.kyc.exceptions import InvalidImageError, LivenessDetectionError, NoFaceInSelfieError
from src.kyc.liveness_service import LivenessService


def _test_settings(threshold: float = 0.8) -> KYCSettings:
    """Create test settings with configurable liveness threshold."""
    return KYCSettings(
        ai_service_auth_token="test-token",
        kyc_liveness_threshold=threshold,
    )


class MockAntiSpoofingEngine:
    """Mock engine that returns a configurable prediction result."""

    def __init__(self, score: float, face_detected: bool = True) -> None:
        """Initialize with fixed prediction values.

        Args:
            score: Liveness score to return (0.0-1.0).
            face_detected: Whether to report a face was detected.
        """
        self.score = score
        self.face_detected = face_detected
        self.call_count = 0
        self.last_image_shape: tuple[int, ...] | None = None

    def predict(self, image: np.ndarray) -> dict[str, Any]:
        """Return configured prediction result.

        Args:
            image: Input image (tracked for verification).

        Returns:
            Prediction dict with score and face_detected.
        """
        self.call_count += 1
        self.last_image_shape = image.shape
        return {
            "score": self.score,
            "face_detected": self.face_detected,
        }


class MockFailingEngine:
    """Mock engine that raises an exception on predict."""

    def __init__(self, error: Exception) -> None:
        """Initialize with the exception to raise.

        Args:
            error: Exception to raise on predict call.
        """
        self.error = error

    def predict(self, image: np.ndarray) -> dict[str, Any]:
        """Raise the configured exception.

        Args:
            image: Ignored.

        Raises:
            The configured exception.
        """
        raise self.error


def _fake_image(height: int = 300, width: int = 200) -> np.ndarray:
    """Create a fake BGR image for testing."""
    return np.zeros((height, width, 3), dtype=np.uint8)


class TestLivenessDetectionLiveImage:
    """Test valid liveness detection where image is classified as live."""

    def test_high_score_returns_is_live_true(self) -> None:
        """Score above threshold returns is_live=True."""
        engine = MockAntiSpoofingEngine(score=0.95)
        service = LivenessService(settings=_test_settings(threshold=0.8), engine=engine)

        result = service.detect_liveness(_fake_image())

        assert result.liveness_score == pytest.approx(0.95)
        assert result.is_live is True

    def test_score_exactly_at_threshold_returns_live(self) -> None:
        """Score exactly at threshold returns is_live=True (>=)."""
        engine = MockAntiSpoofingEngine(score=0.8)
        service = LivenessService(settings=_test_settings(threshold=0.8), engine=engine)

        result = service.detect_liveness(_fake_image())

        assert result.liveness_score == pytest.approx(0.8)
        assert result.is_live is True

    def test_perfect_score_returns_live(self) -> None:
        """Maximum score 1.0 returns is_live=True."""
        engine = MockAntiSpoofingEngine(score=1.0)
        service = LivenessService(settings=_test_settings(threshold=0.8), engine=engine)

        result = service.detect_liveness(_fake_image())

        assert result.liveness_score == pytest.approx(1.0)
        assert result.is_live is True


class TestLivenessDetectionSpoofImage:
    """Test valid liveness detection where image is classified as spoof."""

    def test_low_score_returns_is_live_false(self) -> None:
        """Score below threshold returns is_live=False."""
        engine = MockAntiSpoofingEngine(score=0.3)
        service = LivenessService(settings=_test_settings(threshold=0.8), engine=engine)

        result = service.detect_liveness(_fake_image())

        assert result.liveness_score == pytest.approx(0.3)
        assert result.is_live is False

    def test_score_just_below_threshold_returns_not_live(self) -> None:
        """Score just below threshold returns is_live=False."""
        engine = MockAntiSpoofingEngine(score=0.79)
        service = LivenessService(settings=_test_settings(threshold=0.8), engine=engine)

        result = service.detect_liveness(_fake_image())

        assert result.liveness_score == pytest.approx(0.79)
        assert result.is_live is False

    def test_zero_score_returns_not_live(self) -> None:
        """Minimum score 0.0 returns is_live=False."""
        engine = MockAntiSpoofingEngine(score=0.0)
        service = LivenessService(settings=_test_settings(threshold=0.8), engine=engine)

        result = service.detect_liveness(_fake_image())

        assert result.liveness_score == pytest.approx(0.0)
        assert result.is_live is False


class TestThresholdBoundaryBehavior:
    """Test threshold boundary behavior with different threshold values."""

    def test_custom_low_threshold(self) -> None:
        """Custom low threshold allows lower scores to pass."""
        engine = MockAntiSpoofingEngine(score=0.5)
        service = LivenessService(settings=_test_settings(threshold=0.4), engine=engine)

        result = service.detect_liveness(_fake_image())

        assert result.is_live is True

    def test_custom_high_threshold(self) -> None:
        """Custom high threshold rejects moderate scores."""
        engine = MockAntiSpoofingEngine(score=0.85)
        service = LivenessService(settings=_test_settings(threshold=0.9), engine=engine)

        result = service.detect_liveness(_fake_image())

        assert result.is_live is False

    def test_score_clamped_to_unit_range(self) -> None:
        """Score is clamped between 0.0 and 1.0."""
        engine = MockAntiSpoofingEngine(score=1.5)  # Artificially high
        service = LivenessService(settings=_test_settings(threshold=0.8), engine=engine)

        result = service.detect_liveness(_fake_image())

        assert result.liveness_score == pytest.approx(1.0)
        assert result.is_live is True


class TestNoFaceDetected:
    """Test when no face is detected in the selfie."""

    def test_no_face_detected_raises_error(self) -> None:
        """NoFaceInSelfieError raised when engine reports no face."""
        engine = MockAntiSpoofingEngine(score=0.0, face_detected=False)
        service = LivenessService(settings=_test_settings(), engine=engine)

        with pytest.raises(NoFaceInSelfieError, match="No face detected"):
            service.detect_liveness(_fake_image())

    def test_engine_raises_no_face_error_propagates(self) -> None:
        """NoFaceInSelfieError from engine propagates directly."""
        engine = MockFailingEngine(NoFaceInSelfieError("No face in image"))
        service = LivenessService(settings=_test_settings(), engine=engine)

        with pytest.raises(NoFaceInSelfieError):
            service.detect_liveness(_fake_image())


class TestLivenessDetectionFailure:
    """Test liveness detection error handling."""

    def test_engine_raises_liveness_error_propagates(self) -> None:
        """LivenessDetectionError from engine propagates directly."""
        engine = MockFailingEngine(LivenessDetectionError("Model failure"))
        service = LivenessService(settings=_test_settings(), engine=engine)

        with pytest.raises(LivenessDetectionError, match="Model failure"):
            service.detect_liveness(_fake_image())

    def test_unexpected_engine_error_wrapped_as_liveness_error(self) -> None:
        """Unexpected exception from engine is wrapped in LivenessDetectionError."""
        engine = MockFailingEngine(RuntimeError("GPU out of memory"))
        service = LivenessService(settings=_test_settings(), engine=engine)

        with pytest.raises(LivenessDetectionError, match="could not be completed"):
            service.detect_liveness(_fake_image())


class TestInvalidImageHandling:
    """Test invalid image handling in decode_image."""

    def test_empty_bytes_raises_invalid_image(self) -> None:
        """Empty bytes input raises InvalidImageError."""
        service = LivenessService(settings=_test_settings())

        with pytest.raises(InvalidImageError, match="Could not decode"):
            service.decode_image(b"")

    def test_garbage_bytes_raises_invalid_image(self) -> None:
        """Non-image bytes raise InvalidImageError."""
        service = LivenessService(settings=_test_settings())

        with pytest.raises(InvalidImageError, match="Could not decode"):
            service.decode_image(b"not-an-image-at-all")

    def test_valid_image_decodes_successfully(self) -> None:
        """Valid image bytes decode to numpy array."""
        import cv2

        img = np.zeros((50, 50, 3), dtype=np.uint8)
        _, buffer = cv2.imencode(".jpg", img)
        image_bytes = buffer.tobytes()

        service = LivenessService(settings=_test_settings())
        result = service.decode_image(image_bytes)

        assert isinstance(result, np.ndarray)
        assert len(result.shape) == 3


class TestNoPersistentState:
    """Test that the service has no persistent state after detection."""

    def test_service_has_no_score_storage(self) -> None:
        """LivenessService has no attribute for storing scores or results."""
        service = LivenessService(settings=_test_settings())

        # Check instance vars (not methods) for storage attributes
        instance_vars = vars(service)
        storage_attrs = [
            key for key in instance_vars
            if ("score" in key.lower() or "result" in key.lower())
            and key not in ("_engine", "_settings")
        ]
        assert storage_attrs == []

    def test_detection_leaves_no_state(self) -> None:
        """After detection, no scores or results remain on the service."""
        engine = MockAntiSpoofingEngine(score=0.9)
        service = LivenessService(settings=_test_settings(), engine=engine)

        service.detect_liveness(_fake_image())

        # Service should not retain any detection data
        instance_vars = vars(service)
        for key in instance_vars:
            if key in ("_engine", "_settings"):
                continue
            # No new instance attributes should exist after detection
            assert "score" not in key.lower()
            assert "result" not in key.lower()
            assert "liveness" not in key.lower()

    def test_multiple_detections_independent(self) -> None:
        """Multiple detections do not interfere with each other."""
        engine = MockAntiSpoofingEngine(score=0.9)
        service = LivenessService(settings=_test_settings(threshold=0.8), engine=engine)

        result1 = service.detect_liveness(_fake_image())

        # Change engine score for second detection
        engine.score = 0.3
        result2 = service.detect_liveness(_fake_image())

        assert result1.is_live is True
        assert result2.is_live is False
        assert engine.call_count == 2
