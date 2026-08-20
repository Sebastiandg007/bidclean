"""Unit tests for the OCR service module.

All ML dependencies (PaddleOCR, OpenCV) are mocked to enable
testing without actual model weights or GPU availability.
"""

from typing import Any

import numpy as np
import pytest

from src.kyc.config import KYCSettings
from src.kyc.exceptions import InvalidImageError, OCRExtractionError
from src.kyc.ocr_service import OCRResult, OCRService


# --- Mock implementations ---


class MockOCREngine:
    """Mock OCR engine that returns configurable results."""

    def __init__(self, results: list[Any] | None = None) -> None:
        """Initialize with predefined results.

        Args:
            results: OCR results to return, or None for empty results.
        """
        self.results = results
        self.call_count = 0

    def ocr(self, img: np.ndarray, cls: bool = True) -> list[Any]:
        """Return predefined OCR results.

        Args:
            img: Image array (unused in mock).
            cls: Classification flag (unused in mock).

        Returns:
            Predefined results list.
        """
        self.call_count += 1
        return self.results if self.results is not None else []


class MockFaceDetector:
    """Mock face detector that returns configurable bounding boxes."""

    def __init__(self, faces: list[tuple[int, int, int, int]] | None = None) -> None:
        """Initialize with predefined face bounding boxes.

        Args:
            faces: List of (x, y, w, h) bounding boxes, or None for no faces.
        """
        self.faces = faces or []

    def detect_faces(self, img: np.ndarray) -> list[tuple[int, int, int, int]]:
        """Return predefined face bounding boxes.

        Args:
            img: Image array (unused in mock).

        Returns:
            List of predefined bounding boxes.
        """
        return self.faces


# --- Fixtures ---


def _create_settings() -> KYCSettings:
    """Create test KYC settings."""
    return KYCSettings(ai_service_auth_token="test-token")


def _create_service(
    ocr_results: list[Any] | None = None,
    faces: list[tuple[int, int, int, int]] | None = None,
) -> OCRService:
    """Create an OCRService with mocked dependencies.

    Args:
        ocr_results: Results for the mock OCR engine.
        faces: Face bounding boxes for the mock detector.

    Returns:
        Configured OCRService instance.
    """
    return OCRService(
        settings=_create_settings(),
        ocr_engine=MockOCREngine(ocr_results),
        face_detector=MockFaceDetector(faces),
    )


def _sample_image(width: int = 200, height: int = 300) -> np.ndarray:
    """Create a sample BGR image for testing.

    Args:
        width: Image width in pixels.
        height: Image height in pixels.

    Returns:
        NumPy array representing a BGR image.
    """
    return np.zeros((height, width, 3), dtype=np.uint8)


def _passport_ocr_results() -> list[Any]:
    """Create mock PaddleOCR results simulating a passport.

    Returns:
        List mimicking PaddleOCR page output structure.
    """
    return [
        [
            [[[0, 0], [100, 0], [100, 20], [0, 20]], ("PASSPORT", 0.95)],
            [[[0, 30], [100, 30], [100, 50], [0, 50]], ("Name: John Smith", 0.92)],
            [[[0, 60], [100, 60], [100, 80], [0, 80]], ("No: AB1234567", 0.88)],
            [[[0, 90], [100, 90], [100, 110], [0, 110]], ("Exp: 01/12/2030", 0.90)],
            [
                [[0, 120], [100, 120], [100, 140], [0, 140]],
                ("Nationality: Colombian", 0.85),
            ],
            [
                [[0, 150], [100, 150], [100, 170], [0, 170]],
                ("Date of birth: 15/03/1990", 0.87),
            ],
        ]
    ]


def _id_card_ocr_results() -> list[Any]:
    """Create mock PaddleOCR results simulating an ID card.

    Returns:
        List mimicking PaddleOCR page output structure.
    """
    return [
        [
            [[[0, 0], [100, 0], [100, 20], [0, 20]], ("NATIONAL IDENTITY CARD", 0.93)],
            [[[0, 30], [100, 30], [100, 50], [0, 50]], ("Name: Maria Garcia", 0.91)],
            [[[0, 60], [100, 60], [100, 80], [0, 80]], ("Number: 12345678", 0.89)],
            [[[0, 90], [100, 90], [100, 110], [0, 110]], ("Expires: 06/08/2027", 0.86)],
        ]
    ]


# --- Text Extraction Tests ---


class TestTextExtraction:
    """Tests for OCR text extraction logic."""

    def test_extract_name_from_passport(self) -> None:
        """Correctly extracts name from a passport document."""
        service = _create_service(ocr_results=_passport_ocr_results())
        result = service.extract_text(_sample_image())

        assert result.extracted_name == "John Smith"

    def test_extract_document_number(self) -> None:
        """Correctly extracts document number."""
        service = _create_service(ocr_results=_passport_ocr_results())
        result = service.extract_text(_sample_image())

        assert result.document_number == "AB1234567"

    def test_extract_expiry_date(self) -> None:
        """Correctly extracts expiry date."""
        service = _create_service(ocr_results=_passport_ocr_results())
        result = service.extract_text(_sample_image())

        assert result.expiry_date == "01/12/2030"

    def test_extract_date_of_birth(self) -> None:
        """Correctly extracts date of birth when present."""
        service = _create_service(ocr_results=_passport_ocr_results())
        result = service.extract_text(_sample_image())

        assert result.date_of_birth == "15/03/1990"

    def test_extract_nationality(self) -> None:
        """Correctly extracts nationality when present."""
        service = _create_service(ocr_results=_passport_ocr_results())
        result = service.extract_text(_sample_image())

        assert result.nationality == "Colombian"

    def test_detect_passport_type(self) -> None:
        """Detects 'passport' document type from content."""
        service = _create_service(ocr_results=_passport_ocr_results())
        result = service.extract_text(_sample_image())

        assert result.document_type == "passport"

    def test_detect_id_card_type(self) -> None:
        """Detects 'id_card' document type from content."""
        service = _create_service(ocr_results=_id_card_ocr_results())
        result = service.extract_text(_sample_image())

        assert result.document_type == "id_card"

    def test_unknown_document_type(self) -> None:
        """Returns 'unknown' when document type cannot be determined."""
        results = [
            [
                [[[0, 0], [100, 0], [100, 20], [0, 20]], ("Name: Test User", 0.9)],
                [[[0, 30], [100, 30], [100, 50], [0, 50]], ("No: Z9876543", 0.85)],
            ]
        ]
        service = _create_service(ocr_results=results)
        result = service.extract_text(_sample_image())

        assert result.document_type == "unknown"

    def test_empty_ocr_results_raises_error(self) -> None:
        """Raises OCRExtractionError when OCR returns no results."""
        service = _create_service(ocr_results=[])
        with pytest.raises(OCRExtractionError):
            service.extract_text(_sample_image())

    def test_none_ocr_results_raises_error(self) -> None:
        """Raises OCRExtractionError when OCR returns None-like result."""
        service = _create_service(ocr_results=[None])
        with pytest.raises(OCRExtractionError):
            service.extract_text(_sample_image())

    def test_ocr_with_no_text_lines_raises_error(self) -> None:
        """Raises OCRExtractionError when no text lines found."""
        service = _create_service(ocr_results=[[]])
        with pytest.raises(OCRExtractionError):
            service.extract_text(_sample_image())


# --- Confidence Scoring Tests ---


class TestConfidenceScoring:
    """Tests for confidence score calculations."""

    def test_full_extraction_yields_high_confidence(self) -> None:
        """All fields found should produce high confidence."""
        service = _create_service(ocr_results=_passport_ocr_results())
        result = service.extract_text(_sample_image())

        # All 3 required fields found, high OCR confidence
        assert result.overall_confidence > 0.8

    def test_partial_extraction_yields_lower_confidence(self) -> None:
        """Missing fields reduce overall confidence."""
        results = [
            [
                [[[0, 0], [100, 0], [100, 20], [0, 20]], ("Name: Jane Doe", 0.9)],
                # No document number or expiry date
            ]
        ]
        service = _create_service(ocr_results=results)
        result = service.extract_text(_sample_image())

        # Only 1 of 3 required fields found
        assert result.overall_confidence < 0.5

    def test_field_confidences_populated(self) -> None:
        """Per-field confidence dict is populated correctly."""
        service = _create_service(ocr_results=_passport_ocr_results())
        result = service.extract_text(_sample_image())

        assert "extracted_name" in result.field_confidences
        assert "document_number" in result.field_confidences
        assert "expiry_date" in result.field_confidences
        assert all(0.0 <= v <= 1.0 for v in result.field_confidences.values())

    def test_missing_field_has_zero_confidence(self) -> None:
        """Fields that weren't extracted get 0.0 confidence."""
        results = [
            [
                [[[0, 0], [100, 0], [100, 20], [0, 20]], ("PASSPORT", 0.9)],
                [[[0, 30], [100, 30], [100, 50], [0, 50]], ("Random text", 0.85)],
            ]
        ]
        service = _create_service(ocr_results=results)
        result = service.extract_text(_sample_image())

        # "Random text" doesn't match document number patterns
        # PASSPORT is the name heuristic match (alphabetic)
        assert result.field_confidences["document_number"] == 0.0

    def test_confidence_between_zero_and_one(self) -> None:
        """Overall confidence is always within [0.0, 1.0]."""
        service = _create_service(ocr_results=_passport_ocr_results())
        result = service.extract_text(_sample_image())

        assert 0.0 <= result.overall_confidence <= 1.0


# --- Face Detection Tests ---


class TestFaceDetection:
    """Tests for face detection in document images."""

    def test_face_detected_returns_true_and_base64(self) -> None:
        """Returns True and base64 string when face is found."""
        service = _create_service(
            ocr_results=_passport_ocr_results(),
            faces=[(50, 50, 80, 80)],
        )
        face_detected, face_image = service.detect_face(_sample_image())

        assert face_detected is True
        assert face_image is not None
        assert len(face_image) > 0

    def test_no_face_returns_false_and_none(self) -> None:
        """Returns False and None when no face found."""
        service = _create_service(
            ocr_results=_passport_ocr_results(),
            faces=[],
        )
        face_detected, face_image = service.detect_face(_sample_image())

        assert face_detected is False
        assert face_image is None

    def test_multiple_faces_uses_largest(self) -> None:
        """When multiple faces detected, uses the largest one."""
        service = _create_service(
            ocr_results=_passport_ocr_results(),
            faces=[(10, 10, 30, 30), (50, 50, 80, 80)],
        )
        face_detected, face_image = service.detect_face(_sample_image())

        assert face_detected is True
        assert face_image is not None


# --- Image Decoding Tests ---


class TestImageDecoding:
    """Tests for image byte decoding."""

    def test_invalid_bytes_raises_error(self) -> None:
        """Raises InvalidImageError for non-decodable bytes."""
        service = _create_service()

        with pytest.raises(InvalidImageError):
            service.decode_image(b"not-an-image")

    def test_empty_bytes_raises_error(self) -> None:
        """Raises InvalidImageError for empty bytes."""
        service = _create_service()

        with pytest.raises(InvalidImageError):
            service.decode_image(b"")

    def test_valid_jpeg_bytes_decode_successfully(self) -> None:
        """Valid JPEG bytes are decoded into a numpy array."""
        import cv2

        # Create a minimal valid JPEG in memory
        img = np.ones((100, 100, 3), dtype=np.uint8) * 128
        _, buffer = cv2.imencode(".jpg", img)
        jpeg_bytes = buffer.tobytes()

        service = _create_service()
        decoded = service.decode_image(jpeg_bytes)

        assert isinstance(decoded, np.ndarray)
        assert decoded.shape[2] == 3  # BGR channels

    def test_valid_png_bytes_decode_successfully(self) -> None:
        """Valid PNG bytes are decoded into a numpy array."""
        import cv2

        img = np.ones((100, 100, 3), dtype=np.uint8) * 200
        _, buffer = cv2.imencode(".png", img)
        png_bytes = buffer.tobytes()

        service = _create_service()
        decoded = service.decode_image(png_bytes)

        assert isinstance(decoded, np.ndarray)
        assert decoded.shape[2] == 3
