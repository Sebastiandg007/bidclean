"""Face comparison service using DeepFace for identity verification.

Encapsulates DeepFace for face embedding extraction and cosine similarity
calculation. Uses dependency injection so DeepFace can be mocked in tests.
Face embeddings are used ONLY in memory during comparison and are NEVER stored.
"""

import logging
from typing import Any, Protocol

import numpy as np

from src.kyc.config import KYCSettings
from src.kyc.exceptions import (
    FaceExtractionError,
    InvalidImageError,
    MultipleFacesError,
    NoFaceInSelfieError,
)

logger = logging.getLogger(__name__)


class FaceEmbeddingEngine(Protocol):
    """Protocol for face embedding dependency injection.

    Allows swapping DeepFace with a mock in tests without
    requiring actual ML model weights.
    """

    def represent(
        self,
        img_path: np.ndarray,
        model_name: str,
        enforce_detection: bool,
        detector_backend: str,
    ) -> list[dict[str, Any]]:
        """Extract face embeddings from an image.

        Args:
            img_path: NumPy array of the image (BGR format).
            model_name: Name of the face recognition model.
            enforce_detection: Whether to raise error if no face found.
            detector_backend: Face detection backend to use.

        Returns:
            List of face representation dicts with 'embedding' key.
        """
        ...


class DeepFaceEngine:
    """Wrapper around DeepFace with lazy initialization."""

    def __init__(self) -> None:
        """Initialize without loading the model (lazy loading)."""
        self._deepface: Any = None

    def _ensure_loaded(self) -> None:
        """Lazy-load DeepFace on first use."""
        if self._deepface is None:
            from deepface import DeepFace

            self._deepface = DeepFace
            logger.info("DeepFace engine loaded successfully")

    def represent(
        self,
        img_path: np.ndarray,
        model_name: str,
        enforce_detection: bool,
        detector_backend: str,
    ) -> list[dict[str, Any]]:
        """Extract face embeddings from an image.

        Args:
            img_path: NumPy array of the image (BGR format).
            model_name: Name of the face recognition model.
            enforce_detection: Whether to raise error if no face found.
            detector_backend: Face detection backend to use.

        Returns:
            List of face representation dicts with 'embedding' key.
        """
        self._ensure_loaded()
        return self._deepface.represent(
            img_path=img_path,
            model_name=model_name,
            enforce_detection=enforce_detection,
            detector_backend=detector_backend,
        )


# --- Configuration constants ---
DEEPFACE_MODEL_NAME = "VGG-Face"
DEEPFACE_DETECTOR_BACKEND = "opencv"


class FaceCompareResult:
    """Result of a face comparison operation.

    Attributes:
        similarity_score: Cosine similarity between two faces (0.0–1.0).
        is_match: Whether similarity exceeds the configured threshold.
    """

    def __init__(self, similarity_score: float, is_match: bool) -> None:
        """Initialize face comparison result.

        Args:
            similarity_score: Cosine similarity score.
            is_match: Whether threshold is met.
        """
        self.similarity_score = similarity_score
        self.is_match = is_match


class FaceCompareService:
    """Service for face comparison using DeepFace embeddings.

    Uses dependency injection for the embedding engine, enabling
    easy mocking in tests. Embeddings exist only in memory and
    are never persisted.

    Args:
        settings: KYC configuration settings.
        engine: Face embedding engine (defaults to DeepFace).
    """

    def __init__(
        self,
        settings: KYCSettings,
        engine: FaceEmbeddingEngine | None = None,
    ) -> None:
        """Initialize the face comparison service.

        Args:
            settings: KYC configuration settings.
            engine: Embedding engine (None = use DeepFace).
        """
        self._settings = settings
        self._engine = engine or DeepFaceEngine()

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

    def compare_faces(
        self,
        document_face_image: np.ndarray,
        selfie_image: np.ndarray,
    ) -> FaceCompareResult:
        """Compare a document face against a selfie face.

        Extracts embeddings from both images, validates single face in selfie,
        calculates cosine similarity, and evaluates against threshold.
        Embeddings are discarded after comparison — never stored.

        Args:
            document_face_image: NumPy array of document face (BGR).
            selfie_image: NumPy array of selfie (BGR).

        Returns:
            FaceCompareResult with similarity score and match determination.

        Raises:
            FaceExtractionError: If embeddings cannot be extracted from document.
            NoFaceInSelfieError: If no face is found in selfie.
            MultipleFacesError: If more than one face is found in selfie.
        """
        doc_embedding = self._extract_document_embedding(document_face_image)
        selfie_embedding = self._extract_selfie_embedding(selfie_image)

        similarity = self._cosine_similarity(doc_embedding, selfie_embedding)
        is_match = similarity >= self._settings.kyc_face_similarity_threshold

        logger.info(
            "Face comparison completed — similarity=%.4f, threshold=%.4f, is_match=%s",
            similarity,
            self._settings.kyc_face_similarity_threshold,
            is_match,
        )

        return FaceCompareResult(similarity_score=similarity, is_match=is_match)

    def _extract_document_embedding(self, image: np.ndarray) -> list[float]:
        """Extract face embedding from the document face image.

        Args:
            image: NumPy array of the document face.

        Returns:
            Embedding vector as list of floats.

        Raises:
            FaceExtractionError: If no face or embedding extraction fails.
        """
        try:
            representations = self._engine.represent(
                img_path=image,
                model_name=DEEPFACE_MODEL_NAME,
                enforce_detection=True,
                detector_backend=DEEPFACE_DETECTOR_BACKEND,
            )
        except (FaceExtractionError, NoFaceInSelfieError, MultipleFacesError):
            raise
        except Exception as exc:
            logger.warning("Cannot extract face from document image: %s", str(exc))
            raise FaceExtractionError("No face detected in document image") from exc

        if not representations:
            raise FaceExtractionError("No face detected in document image")

        return representations[0]["embedding"]

    def _extract_selfie_embedding(self, image: np.ndarray) -> list[float]:
        """Extract face embedding from the selfie image.

        Validates that exactly one face is present in the selfie.

        Args:
            image: NumPy array of the selfie.

        Returns:
            Embedding vector as list of floats.

        Raises:
            NoFaceInSelfieError: If no face is detected.
            MultipleFacesError: If more than one face is detected.
        """
        try:
            representations = self._engine.represent(
                img_path=image,
                model_name=DEEPFACE_MODEL_NAME,
                enforce_detection=True,
                detector_backend=DEEPFACE_DETECTOR_BACKEND,
            )
        except (NoFaceInSelfieError, MultipleFacesError):
            raise
        except Exception as exc:
            logger.warning("No face detected in selfie: %s", str(exc))
            raise NoFaceInSelfieError() from exc

        if not representations:
            raise NoFaceInSelfieError()

        if len(representations) > 1:
            raise MultipleFacesError()

        return representations[0]["embedding"]

    def _cosine_similarity(
        self, embedding_a: list[float], embedding_b: list[float]
    ) -> float:
        """Calculate cosine similarity between two embedding vectors.

        Args:
            embedding_a: First embedding vector.
            embedding_b: Second embedding vector.

        Returns:
            Cosine similarity normalized to 0.0–1.0 range.
        """
        vec_a = np.array(embedding_a, dtype=np.float64)
        vec_b = np.array(embedding_b, dtype=np.float64)

        dot_product = np.dot(vec_a, vec_b)
        norm_a = np.linalg.norm(vec_a)
        norm_b = np.linalg.norm(vec_b)

        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0

        similarity = dot_product / (norm_a * norm_b)
        # Clamp to [0.0, 1.0] range
        return float(max(0.0, min(1.0, similarity)))
