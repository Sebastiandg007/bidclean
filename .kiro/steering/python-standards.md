---
inclusion: fileMatch
fileMatchPattern: "**/*.py"
---

# Python Standards

## General

- Python 3.11+ required.
- Type hints on ALL function signatures (parameters and return types).
- PEP 8 compliance enforced by Ruff.
- Black formatting (line length 100).
- isort for import ordering (compatible with Black).

## Project Structure

- Use Poetry for dependency management (pyproject.toml + poetry.lock).
- Virtual environment per service (never global installs).
- Source code under `src/` directory.
- Tests under `tests/` mirroring the source structure.

## Type Hints

```python
# Always type hints
def compare_faces(image_a: bytes, image_b: bytes) -> float:
    """Return similarity score between 0.0 and 1.0."""
    ...

# Use Optional for nullable
def get_translation(text: str, target_lang: str) -> Optional[str]:
    ...

# Use TypedDict for structured data
class VerificationResult(TypedDict):
    is_match: bool
    confidence: float
    error: Optional[str]
```

## Docstrings

- Google style docstrings on all public functions and classes.
- Include: brief description, Args, Returns, Raises.

```python
def verify_document(image: bytes, country: str) -> DocumentData:
    """Extract and validate data from an identity document.

    Args:
        image: Raw bytes of the document photo.
        country: ISO 3166-1 alpha-2 country code.

    Returns:
        Extracted document data with validation status.

    Raises:
        InvalidDocumentError: If the image is not a recognizable document.
        OCRFailureError: If text extraction fails.
    """
```

## Error Handling

- Define custom exceptions per domain:
  ```python
  class BidCleanError(Exception):
      """Base exception for all BidClean AI service errors."""

  class FaceComparisonError(BidCleanError):
      """Raised when face comparison cannot be completed."""
  ```
- Never bare `except:` — always catch specific exceptions.
- Use logging with structured context, not print statements.

## API Endpoints (FastAPI)

- One router file per domain (`routes/verification.py`, `routes/translation.py`).
- Pydantic models for all request/response bodies.
- Dependency injection for shared services.
- HTTP status codes used correctly (201 created, 422 validation error, etc.).

## Testing

- pytest as the test runner.
- Hypothesis for property-based testing of ML functions.
- Fixtures for shared test setup.
- Test file naming: `test_<module>.py`.
- Minimum coverage: 70% on core functions.

## Logging

- Use Python's `logging` module with structured output (JSON format for production).
- Log levels used correctly: DEBUG for dev, INFO for operations, WARNING for recoverable issues, ERROR for failures.
- Never log sensitive data (documents, faces, personal info).
