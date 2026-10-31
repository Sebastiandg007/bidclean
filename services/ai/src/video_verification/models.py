"""Pydantic response models for the video-verification AI endpoint."""

from typing import Literal

from pydantic import BaseModel, Field

# The three advisory decisions the endpoint can return.
Decision = Literal["MATCH", "NO_MATCH", "INCONCLUSIVE"]


class VerifyFaceResponse(BaseModel):
    """Response from the ``/verify-face`` endpoint.

    Attributes:
        score: Cosine similarity between the arrival face and the reference (0.0-1.0).
        decision: Advisory outcome — MATCH / NO_MATCH (against the endpoint's own threshold) or
            INCONCLUSIVE when no usable face could be compared. The API worker re-derives the
            authoritative decision against the per-verification snapshot threshold.
    """

    score: float = Field(default=0.0, ge=0.0, le=1.0)
    decision: Decision = "INCONCLUSIVE"
