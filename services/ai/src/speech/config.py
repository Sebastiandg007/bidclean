"""Speech (transcription) configuration loaded from environment variables.

Uses pydantic-settings BaseSettings to validate and load configuration at
startup. A cached singleton is provided via get_speech_settings().
"""

from functools import lru_cache

from pydantic_settings import BaseSettings


class SpeechSettings(BaseSettings):
    """Speech-to-text service configuration.

    All values load from environment variables. The Whisper model/params are
    configurable so a deployment can trade accuracy for CPU cost without code
    changes. The service is given NO storage credentials (Option A: it only
    ever receives audio bytes over the wire).

    Attributes:
        ai_service_auth_token: Bearer token for service-to-service auth.
        whisper_model: Whisper.cpp model name/size (e.g. 'base', 'small').
        whisper_language: Optional forced language code; empty = auto-detect.
        speech_max_audio_bytes: Reject audio larger than this many bytes (422).
    """

    ai_service_auth_token: str = ""
    whisper_model: str = "base"
    whisper_language: str = ""
    speech_max_audio_bytes: int = 26_214_400

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache(maxsize=1)
def get_speech_settings() -> SpeechSettings:
    """Return a cached singleton of speech settings.

    Returns:
        SpeechSettings loaded from environment variables.
    """
    return SpeechSettings()
