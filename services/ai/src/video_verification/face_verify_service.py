"""On-arrival face-verification service using DeepFace.

Compares a candidate arrival-video frame against a reference KYC selfie. A representative frame is
extracted from the candidate video, embeddings are produced by DeepFace (the same library the KYC
face-compare uses), and a cosine similarity drives an advisory MATCH/NO_MATCH/INCONCLUSIVE decision.

Both the frame extractor and the embedding engine are dependency-injected so the service can be
tested with representative image pairs and stubs — no native video decoder or ML weights in CI. Face
embeddings exist ONLY in memory during comparison and are NEVER persisted. The service has NO MinIO
access (Option A): it operates purely on the bytes it is given.
"""

import logging
from typing import Any, Protocol

import numpy as np

from src.video_verification.config import VideoVerificationSettings
from src.video_verification.exceptions import InvalidMediaError
from src.video_verification.models import VerifyFaceResponse

logger = logging.getLogger(__name__)

# --- Configuration constants (mirror the KYC face-compare model choice) ---
DEEPFACE_MODEL_NAME = "VGG-Face"
DEEPFACE_DETECTOR_BACKEND = "opencv"


class FrameExtractor(Protocol):
    """Protocol for extracting a representative frame from a candidate video's bytes.

    Injected so tests can supply a plain image (or a stub) without a native video decoder.
    """

    def extract_frame(self, video_bytes: bytes) -> np.ndarray:
        """Extract one representative BGR frame from the video bytes.

        Args:
            video_bytes: Raw candidate video (or image) bytes.

        Returns:
            A NumPy array in BGR format representing one frame.

        Raises:
            InvalidMediaError: If no frame can be decoded from the bytes.
        """
        ...


class FaceEmbeddingEngine(Protocol):
    """Protocol for face embedding dependency injection (mirrors the KYC engine)."""

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
            enforce_detection: Whether to raise if no face is found.
            detector_backend: Face detection backend to use.

        Returns:
            List of face representation dicts with an ``embedding`` key.
        """
        ...


class OpenCvFrameExtractor:
    """Frame extractor that decodes a representative frame using OpenCV (lazy import)."""

    def extract_frame(self, video_bytes: bytes) -> np.ndarray:
        """Decode the first usable frame from the candidate video/image bytes.

        Args:
            video_bytes: Raw candidate bytes.

        Returns:
            A BGR NumPy frame.

        Raises:
            InvalidMediaError: If no frame can be decoded.
        """
        import cv2

        if not video_bytes:
            raise InvalidMediaError("Empty candidate media")

        nparr = np.frombuffer(video_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            raise InvalidMediaError("Could not decode a frame from the candidate media")
        return frame


class DeepFaceEngine:
    """Wrapper around DeepFace with lazy initialization (mirrors the KYC engine)."""

    def __init__(self) -> None:
        """Initialize without loading the model (lazy loading)."""
        self._deepface: Any = None

    def _ensure_loaded(self) -> None:
        """Lazy-load DeepFace on first use."""
        if self._deepface is None:
            from deepface import DeepFace

            self._deepface = DeepFace
            logger.info("DeepFace engine loaded for video verification")

    def represent(
        self,
        img_path: np.ndarray,
        model_name: str,
        enforce_detection: bool,
        detector_backend: str,
    ) -> list[dict[str, Any]]:
        """Extract face embeddings from an image via DeepFace."""
        self._ensure_loaded()
        return self._deepface.represent(
            img_path=img_path,
            model_name=model_name,
            enforce_detection=enforce_detection,
            detector_backend=detector_backend,
        )


class FaceVerifyService:
    """Service for on-arrival face comparison using DeepFace embeddings.

    Uses dependency injection for the frame extractor and embedding engine, enabling easy mocking in
    tests. Embeddings exist only in memory and are never persisted. Has NO storage access.
    """

    def __init__(
        self,
        settings: VideoVerificationSettings,
        engine: FaceEmbeddingEngine | None = None,
        frame_extractor: FrameExtractor | None = None,
    ) -> None:
        """Initialize the face-verify service.

        Args:
            settings: Video-verification configuration settings.
            engine: Embedding engine (None = use DeepFace).
            frame_extractor: Candidate frame extractor (None = use OpenCV).
        """
        self._settings = settings
        self._engine = engine or DeepFaceEngine()
        self._frame_extractor = frame_extractor or OpenCvFrameExtractor()

    def verify(self, candidate_video: bytes, reference_image: bytes) -> VerifyFaceResponse:
        """Compare a candidate arrival video against a reference selfie.

        Extracts a representative frame from the candidate, extracts embeddings from both faces,
        computes cosine similarity, and returns an advisory decision. A missing/undetectable face on
        either side yields INCONCLUSIVE (a non-fatal advisory outcome, not an error).

        Args:
            candidate_video: Raw arrival-video (or frame) bytes.
            reference_image: Raw reference KYC selfie bytes.

        Returns:
            The similarity score and advisory decision.

        Raises:
            InvalidMediaError: If the reference image cannot be decoded at all.
        """
        frame = self._frame_extractor.extract_frame(candidate_video)
        reference = self._decode_reference(reference_image)

        candidate_embedding = self._safe_embedding(frame)
        reference_embedding = self._safe_embedding(reference)
        if candidate_embedding is None or reference_embedding is None:
            return VerifyFaceResponse(score=0.0, decision="INCONCLUSIVE")

        score = self._cosine_similarity(candidate_embedding, reference_embedding)
        threshold = self._settings.video_verification_similarity_threshold
        decision = "MATCH" if score >= threshold else "NO_MATCH"
        logger.info("Face verification completed — decision=%s", decision)
        return VerifyFaceResponse(score=score, decision=decision)

    def _decode_reference(self, reference_image: bytes) -> np.ndarray:
        """Decode the reference selfie bytes into a BGR frame.

        Args:
            reference_image: Raw reference bytes.

        Returns:
            A BGR NumPy image.

        Raises:
            InvalidMediaError: If the reference cannot be decoded.
        """
        import cv2

        if not reference_image:
            raise InvalidMediaError("Empty reference image")
        nparr = np.frombuffer(reference_image, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            raise InvalidMediaError("Could not decode the reference image")
        return image

    def _safe_embedding(self, image: np.ndarray) -> list[float] | None:
        """Extract a single face embedding, returning None when no face is detectable.

        Args:
            image: A BGR NumPy frame.

        Returns:
            The embedding vector, or None when no usable face is present.
        """
        try:
            representations = self._engine.represent(
                img_path=image,
                model_name=DEEPFACE_MODEL_NAME,
                enforce_detection=True,
                detector_backend=DEEPFACE_DETECTOR_BACKEND,
            )
        except Exception as exc:  # noqa: BLE001 — model raises assorted errors for "no face"
            logger.info("No usable face detected (treated as inconclusive): %s", str(exc))
            return None
        if not representations:
            return None
        return representations[0]["embedding"]

    def _cosine_similarity(self, embedding_a: list[float], embedding_b: list[float]) -> float:
        """Calculate cosine similarity between two embedding vectors, clamped to [0, 1].

        Args:
            embedding_a: First embedding vector.
            embedding_b: Second embedding vector.

        Returns:
            Cosine similarity normalized to the 0.0-1.0 range.
        """
        vec_a = np.array(embedding_a, dtype=np.float64)
        vec_b = np.array(embedding_b, dtype=np.float64)
        norm_a = np.linalg.norm(vec_a)
        norm_b = np.linalg.norm(vec_b)
        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        similarity = float(np.dot(vec_a, vec_b) / (norm_a * norm_b))
        return max(0.0, min(1.0, similarity))
