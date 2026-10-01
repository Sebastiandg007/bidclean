"""Pydantic response models for the speech (transcription) endpoints."""

from pydantic import BaseModel, Field


class TranscribeResponse(BaseModel):
    """Response from the /transcribe endpoint.

    Attributes:
        text: The recognized transcript (may be empty for silence/noise).
        language: Detected (or forced) BCP-47-ish language code, or null.
    """

    text: str = Field(default="")
    language: str | None = None
