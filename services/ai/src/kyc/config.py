"""KYC configuration loaded from environment variables.

Uses pydantic-settings BaseSettings to validate and load configuration
at startup. A cached singleton is provided via get_kyc_settings().
"""

from functools import lru_cache

from pydantic_settings import BaseSettings


class KYCSettings(BaseSettings):
    """KYC service configuration.

    All values are loaded from environment variables. Thresholds
    default to conservative values that can be overridden per environment.

    Attributes:
        ai_service_auth_token: Bearer token for service-to-service authentication.
        kyc_ocr_confidence_threshold: Minimum OCR confidence score (0.0–1.0).
        kyc_face_similarity_threshold: Minimum face similarity score (0.0–1.0).
        kyc_liveness_threshold: Minimum liveness score (0.0–1.0).
    """

    ai_service_auth_token: str = ""
    kyc_ocr_confidence_threshold: float = 0.7
    kyc_face_similarity_threshold: float = 0.6
    kyc_liveness_threshold: float = 0.8

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache(maxsize=1)
def get_kyc_settings() -> KYCSettings:
    """Return a cached singleton of KYC settings.

    Returns:
        KYCSettings instance loaded from environment variables.
    """
    return KYCSettings()
