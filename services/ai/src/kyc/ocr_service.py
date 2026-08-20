"""OCR service for identity document text extraction and face detection.

Encapsulates PaddleOCR for text extraction and OpenCV for face detection.
Uses dependency injection so the OCR engine can be mocked in tests.
"""

import base64
import logging
import re
from typing import Any, Protocol

import numpy as np

from src.kyc.config import KYCSettings
from src.kyc.exceptions import InvalidImageError, OCRExtractionError

logger = logging.getLogger(__name__)

# --- Face detection tuning constants ---
HAAR_SCALE_FACTOR = 1.1
HAAR_MIN_NEIGHBORS = 5
HAAR_MIN_FACE_SIZE = (30, 30)
FACE_CROP_PADDING_RATIO = 0.1


class OCREngine(Protocol):
    """Protocol for OCR engine dependency injection.

    Allows swapping PaddleOCR with a mock in tests without
    requiring actual ML model weights.
    """

    def ocr(self, img: np.ndarray, cls: bool = True) -> list[Any]:
        """Run OCR on an image array.

        Args:
            img: NumPy array of the image (BGR format).
            cls: Whether to use text direction classification.

        Returns:
            List of OCR results per page.
        """
        ...


class FaceDetector(Protocol):
    """Protocol for face detection dependency injection."""

    def detect_faces(self, img: np.ndarray) -> list[tuple[int, int, int, int]]:
        """Detect faces in an image.

        Args:
            img: NumPy array of the image (BGR format).

        Returns:
            List of bounding boxes as (x, y, w, h) tuples.
        """
        ...


class OpenCVFaceDetector:
    """Face detector using OpenCV's Haar cascade classifier."""

    def __init__(self) -> None:
        """Initialize the Haar cascade face detector."""
        import cv2

        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self._classifier = cv2.CascadeClassifier(cascade_path)

    def detect_faces(self, img: np.ndarray) -> list[tuple[int, int, int, int]]:
        """Detect faces using Haar cascade.

        Args:
            img: NumPy array of the image (BGR format).

        Returns:
            List of bounding boxes as (x, y, w, h) tuples.
        """
        import cv2

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = self._classifier.detectMultiScale(
            gray,
            scaleFactor=HAAR_SCALE_FACTOR,
            minNeighbors=HAAR_MIN_NEIGHBORS,
            minSize=HAAR_MIN_FACE_SIZE,
        )
        if len(faces) == 0:
            return []
        return [(int(x), int(y), int(w), int(h)) for (x, y, w, h) in faces]


class PaddleOCREngine:
    """Wrapper around PaddleOCR with lazy initialization."""

    def __init__(self) -> None:
        """Initialize without loading the model (lazy loading)."""
        self._engine: Any = None

    def _ensure_loaded(self) -> None:
        """Lazy-load PaddleOCR on first use."""
        if self._engine is None:
            from paddleocr import PaddleOCR

            self._engine = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
            logger.info("PaddleOCR engine loaded successfully")

    def ocr(self, img: np.ndarray, cls: bool = True) -> list[Any]:
        """Run OCR on an image array.

        Args:
            img: NumPy array of the image (BGR format).
            cls: Whether to use text direction classification.

        Returns:
            List of OCR results per page.
        """
        self._ensure_loaded()
        return self._engine.ocr(img, cls=cls)


# --- Field extraction patterns ---

NAME_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"(?:name|nombre|nom)\s*[:\-]?\s*(.+)", re.IGNORECASE),
    re.compile(r"(?:surname|apellido)\s*[:\-]?\s*(.+)", re.IGNORECASE),
]

DOCUMENT_NUMBER_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"(?:no|number|num|documento)\s*[:\-.]?\s*([A-Z0-9]{5,20})", re.IGNORECASE),
    re.compile(r"\b([A-Z]{1,3}\d{6,9})\b"),
    re.compile(r"\b(\d{7,12})\b"),
]

EXPIRY_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"(?:exp|expiry|expires|vence|valid)\s*[:\-.]?\s*(\d{2}[/\-]\d{2}[/\-]\d{2,4})"),
    re.compile(r"(\d{2}[/\-]\d{2}[/\-]\d{4})"),
]

DOB_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"(?:dob|birth|nacimiento|date of birth)\s*[:\-.]?\s*(\d{2}[/\-]\d{2}[/\-]\d{2,4})",
        re.IGNORECASE,
    ),
]

NATIONALITY_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"(?:nationality|nacionalidad|nation)\s*[:\-]?\s*([A-Za-z]+)", re.IGNORECASE),
]

DOCUMENT_TYPE_KEYWORDS: dict[str, list[str]] = {
    "passport": ["passport", "pasaporte"],
    "id_card": ["identity", "identidad", "cedula", "national id", "dni"],
    "drivers_license": ["driver", "license", "licencia", "conducir", "driving"],
}


class OCRResult:
    """Structured result from OCR text extraction.

    Attributes:
        extracted_name: Full name found on the document.
        document_number: ID/passport number.
        expiry_date: Expiration date string.
        date_of_birth: Date of birth string (optional).
        nationality: Nationality (optional).
        document_type: Detected type of document.
        field_confidences: Per-field confidence scores.
        overall_confidence: Aggregate confidence score.
        raw_texts: All text lines extracted (for internal use only).
    """

    def __init__(self) -> None:
        """Initialize with empty fields."""
        self.extracted_name: str = ""
        self.document_number: str = ""
        self.expiry_date: str | None = None
        self.date_of_birth: str | None = None
        self.nationality: str | None = None
        self.document_type: str = "unknown"
        self.field_confidences: dict[str, float] = {}
        self.overall_confidence: float = 0.0
        self.raw_texts: list[tuple[str, float]] = []


class OCRService:
    """Service for document OCR extraction and face detection.

    Uses dependency injection for both OCR engine and face detector,
    enabling easy mocking in tests.

    Args:
        settings: KYC configuration settings.
        ocr_engine: OCR engine instance (defaults to PaddleOCR).
        face_detector: Face detector instance (defaults to OpenCV Haar).
    """

    def __init__(
        self,
        settings: KYCSettings,
        ocr_engine: OCREngine | None = None,
        face_detector: FaceDetector | None = None,
    ) -> None:
        """Initialize the OCR service with injected dependencies.

        Args:
            settings: KYC configuration settings.
            ocr_engine: OCR engine (None = use PaddleOCR).
            face_detector: Face detector (None = use OpenCV Haar cascade).
        """
        self._settings = settings
        self._ocr_engine = ocr_engine or PaddleOCREngine()
        self._face_detector = face_detector or OpenCVFaceDetector()

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

    def extract_text(self, image: np.ndarray) -> OCRResult:
        """Extract text fields from a document image.

        Args:
            image: NumPy array of the document image (BGR).

        Returns:
            Structured OCR result with extracted fields and confidences.

        Raises:
            OCRExtractionError: If no text can be extracted.
        """
        result = self._ocr_engine.ocr(image, cls=True)
        if not result or not result[0]:
            raise OCRExtractionError("OCR returned no results")

        ocr_result = OCRResult()
        ocr_result.raw_texts = self._flatten_ocr_results(result[0])

        if not ocr_result.raw_texts:
            raise OCRExtractionError("No text lines detected in document")

        self._extract_fields(ocr_result)
        self._detect_document_type(ocr_result)
        self._calculate_confidences(ocr_result)

        return ocr_result

    def detect_face(self, image: np.ndarray) -> tuple[bool, str | None]:
        """Detect and extract face from a document image.

        Args:
            image: NumPy array of the document image (BGR).

        Returns:
            Tuple of (face_detected, base64_face_crop_or_none).
        """
        faces = self._face_detector.detect_faces(image)
        if not faces:
            return False, None

        # Use the largest detected face
        largest = max(faces, key=lambda f: f[2] * f[3])
        face_crop = self._crop_face(image, largest)
        face_b64 = self._encode_face_base64(face_crop)
        return True, face_b64

    def _flatten_ocr_results(
        self, page_result: list[Any]
    ) -> list[tuple[str, float]]:
        """Flatten PaddleOCR output into (text, confidence) pairs.

        Args:
            page_result: Single page result from PaddleOCR.

        Returns:
            List of (text, confidence) tuples.
        """
        texts: list[tuple[str, float]] = []
        for line in page_result:
            if line and len(line) >= 2:
                text_info = line[1]
                if isinstance(text_info, tuple) and len(text_info) >= 2:
                    texts.append((str(text_info[0]), float(text_info[1])))
        return texts

    def _extract_fields(self, ocr_result: OCRResult) -> None:
        """Extract structured fields from raw OCR text lines.

        Args:
            ocr_result: OCR result to populate with extracted fields.
        """
        lines = ocr_result.raw_texts

        ocr_result.extracted_name = self._extract_name(lines)
        ocr_result.document_number = self._extract_document_number(lines)
        ocr_result.expiry_date = self._extract_date(lines, EXPIRY_PATTERNS)
        ocr_result.date_of_birth = self._extract_date(lines, DOB_PATTERNS)
        ocr_result.nationality = self._extract_nationality(lines)

    def _extract_name(self, lines: list[tuple[str, float]]) -> str:
        """Extract the full name from OCR text lines.

        Args:
            lines: Individual text lines with confidence.

        Returns:
            Extracted name or empty string.
        """
        for text, _ in lines:
            for pattern in NAME_PATTERNS:
                match = pattern.search(text)
                if match:
                    return match.group(1).strip()

        # Heuristic: first line with mostly alphabetic characters (not a keyword)
        for text, _ in lines:
            cleaned = text.strip()
            if len(cleaned) > 3 and cleaned.replace(" ", "").isalpha():
                return cleaned
        return ""

    def _extract_document_number(self, lines: list[tuple[str, float]]) -> str:
        """Extract document number from OCR text lines.

        Args:
            lines: Individual text lines with confidence.

        Returns:
            Extracted document number or empty string.
        """
        for text, _ in lines:
            for pattern in DOCUMENT_NUMBER_PATTERNS:
                match = pattern.search(text)
                if match:
                    return match.group(1).strip()
        return ""

    def _extract_date(
        self, lines: list[tuple[str, float]], patterns: list[re.Pattern[str]]
    ) -> str | None:
        """Extract a date field using provided patterns.

        Args:
            lines: Individual text lines with confidence.
            patterns: Regex patterns to try.

        Returns:
            Extracted date string or None.
        """
        for text, _ in lines:
            for pattern in patterns:
                match = pattern.search(text)
                if match:
                    return match.group(1).strip()
        return None

    def _extract_nationality(self, lines: list[tuple[str, float]]) -> str | None:
        """Extract nationality from OCR text lines.

        Args:
            lines: Individual text lines with confidence.

        Returns:
            Extracted nationality or None.
        """
        for text, _ in lines:
            for pattern in NATIONALITY_PATTERNS:
                match = pattern.search(text)
                if match:
                    return match.group(1).strip()
        return None

    def _detect_document_type(self, ocr_result: OCRResult) -> None:
        """Detect document type from extracted text content.

        Args:
            ocr_result: OCR result to update with detected type.
        """
        all_text_lower = " ".join(text for text, _ in ocr_result.raw_texts).lower()
        for doc_type, keywords in DOCUMENT_TYPE_KEYWORDS.items():
            if any(keyword in all_text_lower for keyword in keywords):
                ocr_result.document_type = doc_type
                return
        ocr_result.document_type = "unknown"

    def _calculate_confidences(self, ocr_result: OCRResult) -> None:
        """Calculate per-field and overall confidence scores.

        Confidence is based on:
        - Whether the field was found (binary)
        - Average OCR confidence of extracted text lines

        Args:
            ocr_result: OCR result to update with confidence scores.
        """
        avg_ocr_confidence = self._average_ocr_confidence(ocr_result.raw_texts)

        field_scores: dict[str, float] = {}
        field_scores["extracted_name"] = (
            avg_ocr_confidence if ocr_result.extracted_name else 0.0
        )
        field_scores["document_number"] = (
            avg_ocr_confidence if ocr_result.document_number else 0.0
        )
        field_scores["expiry_date"] = (
            avg_ocr_confidence if ocr_result.expiry_date else 0.0
        )

        ocr_result.field_confidences = field_scores

        found_fields = sum(1 for v in field_scores.values() if v > 0.0)
        total_fields = len(field_scores)
        coverage_ratio = found_fields / total_fields if total_fields > 0 else 0.0

        ocr_result.overall_confidence = round(avg_ocr_confidence * coverage_ratio, 4)

    def _average_ocr_confidence(self, texts: list[tuple[str, float]]) -> float:
        """Compute average confidence from OCR text lines.

        Args:
            texts: List of (text, confidence) tuples.

        Returns:
            Average confidence value (0.0–1.0).
        """
        if not texts:
            return 0.0
        return sum(conf for _, conf in texts) / len(texts)

    def _crop_face(
        self, image: np.ndarray, bbox: tuple[int, int, int, int]
    ) -> np.ndarray:
        """Crop the face region from the image with padding.

        Args:
            image: Full document image array.
            bbox: Bounding box (x, y, w, h).

        Returns:
            Cropped face image array.
        """
        x, y, w, h = bbox
        padding = int(min(w, h) * FACE_CROP_PADDING_RATIO)
        y_start = max(0, y - padding)
        y_end = min(image.shape[0], y + h + padding)
        x_start = max(0, x - padding)
        x_end = min(image.shape[1], x + w + padding)
        return image[y_start:y_end, x_start:x_end]

    def _encode_face_base64(self, face_img: np.ndarray) -> str:
        """Encode a face crop as base64 JPEG string.

        Args:
            face_img: NumPy array of the face crop.

        Returns:
            Base64-encoded JPEG string.
        """
        import cv2

        _, buffer = cv2.imencode(".jpg", face_img)
        return base64.b64encode(buffer.tobytes()).decode("utf-8")
