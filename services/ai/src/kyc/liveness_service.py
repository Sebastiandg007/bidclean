"""Liveness detection service using Silent-Face-Anti-Spoofing.

Encapsulates anti-spoofing prediction for static presentation-attack
detection (PAD). Uses dependency injection so the ML engine can be
mocked in tests without requiring actual model weights.
Face data is used ONLY in memory and is NEVER stored.
"""

import logging
from typing import Any, Protocol

import numpy as np

from src.kyc.config import KYCSettings
from src.kyc.exceptions import InvalidImageError, LivenessDetectionError, NoFaceInSelfieError

logger = logging.getLogger(__name__)


class AntiSpoofingEngine(Protocol):
    """Protocol for anti-spoofing engine dependency injection.

    Allows swapping Silent-Face-Anti-Spoofing with a mock in tests
    without requiring actual ML model weights.
    """

    def predict(self, image: np.ndarray) -> dict[str, Any]:
        """Run anti-spoofing prediction on a face image.

        Args:
            image: NumPy array of the image (BGR format).

        Returns:
            Dict with 'score' (float 0.0-1.0) and 'face_detected' (bool).
        """
        ...


class SilentFaceEngine:
    """Wrapper around Silent-Face-Anti-Spoofing with lazy initialization."""

    def __init__(self) -> None:
        """Initialize without loading the model (lazy loading)."""
        self._model: Any = None

    def _ensure_loaded(self) -> None:
        """Lazy-load Silent-Face-Anti-Spoofing model on first use."""
        if self._model is None:
            try:
                from silent_face_anti_spoofing import AntiSpoofPredict

                self._model = AntiSpoofPredict()
                logger.info("Silent-Face-Anti-Spoofing engine loaded successfully")
            except ImportError as exc:
                logger.error("Silent-Face-Anti-Spoofing not installed: %s", str(exc))
                raise LivenessDetectionError(
                    "Liveness model not available"
                ) from exc

    def predict(self, image: np.ndarray) -> dict[str, Any]:
        """Run anti-spoofing prediction on a face image.

        Args:
            image: NumPy array of the image (BGR format).

        Returns:
            Dict with 'score' (float 0.0-1.0) and 'face_detected' (bool).

        Raises:
            LivenessDetectionError: If the model fails to analyze the image.
            NoFaceInSelfieError: If no face is detected in the image.
        """
        self._ensure_loaded()
        try:
            result = self._model.predict(image)
            return {
                "score": float(result.get("score", 0.0)),
                "face_detected": bool(result.get("face_detected", False)),
            }
        except Exception as exc:
            logger.warning("Anti-spoofing prediction failed: %s", str(exc))
            raise LivenessDetectionError(
                "Anti-spoofing model could not analyze the image"
            ) from exc


class LivenessResult:
    """Result of a liveness detection operation.

    Attributes:
        liveness_score: Probability the image is a live person (0.0-1.0).
        is_live: Whether liveness score exceeds the configured threshold.
    """

    def __init__(self, liveness_score: float, is_live: bool) -> None:
        """Initialize liveness detection result.

        Args:
            liveness_score: Anti-spoofing confidence score.
            is_live: Whether threshold is met.
        """
        self.liveness_score = liveness_score
        self.is_live = is_live


class LivenessService:
    """Service for liveness detection using anti-spoofing prediction.

    Uses dependency injection for the anti-spoofing engine, enabling
    easy mocking in tests. No biometric data is stored — the model
    output is just a float score.

    Args:
        settings: KYC configuration settings.
        engine: Anti-spoofing engine (defaults to Silent-Face).
    """

    def __init__(
        self,
        settings: KYCSettings,
        engine: AntiSpoofingEngine | None = None,
    ) -> None:
        """Initialize the liveness detection service.

        Args:
            settings: KYC configuration settings.
            engine: Anti-spoofing engine (None = use Silent-Face).
        """
        self._settings = settings
        self._engine = engine or SilentFaceEngine()

    def decode_image(self, image_bytes: bytes) -> np.ndarray:
        """Decode raw bytes into a NumPy image array.

        Args:
            image_bytes: Raw image file bytes.

        Returns:
            NumPy array in BGR format.

        Raises:
            InvalidImageError: If the bytes cannot be decoded as an image.
        """
        import cv2

        if not image_bytes:
            raise InvalidImageError("Could not decode image bytes")

        nparr = np.frombuffer(image_bytes, np.uint8)
        try:
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except cv2.error as exc:
            raise InvalidImageError("Could not decode image bytes") from exc

        if img is None:
            raise InvalidImageError("Could not decode image bytes")
        return img

    def detect_liveness(self, image: np.ndarray) -> LivenessResult:
        """Run anti-spoofing detection on a selfie image.

        Analyzes the image using the anti-spoofing engine and evaluates
        the prediction score against the configured threshold.
        No biometric data is stored — only a float score is produced.

        Args:
            image: NumPy array of the selfie (BGR format).

        Returns:
            LivenessResult with score and live/spoof determination.

        Raises:
            NoFaceInSelfieError: If no face is detected in the image.
            LivenessDetectionError: If the model cannot analyze the image.
        """
        try:
            prediction = self._engine.predict(image)
        except NoFaceInSelfieError:
            raise
        except LivenessDetectionError:
            raise
        except Exception as exc:
            logger.error("Unexpected liveness detection error: %s", str(exc))
            raise LivenessDetectionError(
                "Liveness analysis could not be completed"
            ) from exc

        if not prediction.get("face_detected", False):
            raise NoFaceInSelfieError("No face detected in selfie image")

        score = float(prediction["score"])
        score = max(0.0, min(1.0, score))
        is_live = score >= self._settings.kyc_liveness_threshold

        logger.info(
            "Liveness detection completed — score=%.4f, threshold=%.4f, is_live=%s",
            score,
            self._settings.kyc_liveness_threshold,
            is_live,
        )

        return LivenessResult(liveness_score=score, is_live=is_live)
