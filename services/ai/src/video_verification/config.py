"""Video-verification AI configuration loaded from environment variables.

Uses pydantic-settings BaseSettings to validate and load configuration at startup. A cached
singleton is provided via get_video_verification_settings(). The AI service has NO storage
credentials (Option A) — only the model/threshold params and the shared service auth token.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings


class VideoVerificationSettings(BaseSettings):
    """Video-verification service configuration.

    All values are loaded from environment variables. The threshold is used to derive the
    endpoint's own MATCH/NO_MATCH hint; the authoritative decision is re-derived by the API worker
    against the per-verification snapshot threshold.

    Attributes:
        ai_service_auth_token: Bearer token for service-to-service authentication (shared).
        video_verification_similarity_threshold: Minimum similarity for a MATCH hint (0.0-1.0).
        video_verification_max_file_size_mb: Maximum accepted candidate/reference size in MB.
    """

    ai_service_auth_token: str = ""
    video_verification_similarity_threshold: float = 0.6
    video_verification_max_file_size_mb: int = 20

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache(maxsize=1)
def get_video_verification_settings() -> VideoVerificationSettings:
    """Return a cached singleton of video-verification settings.

    Returns:
        VideoVerificationSettings instance loaded from environment variables.
    """
    return VideoVerificationSettings()
