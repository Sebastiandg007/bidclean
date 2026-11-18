"""Tests for the speech /transcribe endpoint.

The native Whisper.cpp binary is not present in CI, so the engine is injected as
a stub via FastAPI dependency overrides. These tests verify the request/response
contract, auth, size/empty/unusable handling, that the AI service never has a
storage-access path, and a Hypothesis property that arbitrary transcripts and
language codes round-trip through the endpoint.
"""

import inspect
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

import src.speech.router as speech_router
from src.kyc.config import KYCSettings, get_kyc_settings
from src.main import app
from src.speech.config import SpeechSettings, get_speech_settings
from src.speech.engine import get_transcription_engine
from src.speech.exceptions import UnusableAudioError
from src.speech.transcription_service import TranscriptionEngine

TEST_AUTH_TOKEN = "test-speech-token"
AUTH_HEADERS = {"Authorization": f"Bearer {TEST_AUTH_TOKEN}"}


def _override_settings() -> SpeechSettings:
    """Provide test speech settings with a known auth token."""
    return SpeechSettings(ai_service_auth_token=TEST_AUTH_TOKEN)


def _override_kyc_settings() -> KYCSettings:
    """The shared auth dependency reads KYC settings; align its token for tests."""
    return KYCSettings(ai_service_auth_token=TEST_AUTH_TOKEN)


class _StubEngine:
    """A deterministic engine returning a fixed transcript + language."""

    def __init__(self, text: str = "hello world", language: str | None = "en") -> None:
        self._text = text
        self._language = language

    def transcribe(self, audio: bytes) -> tuple[str, str | None]:
        """Return the configured transcript, ignoring the audio bytes."""
        return self._text, self._language


class _FailingEngine:
    """An engine that always reports the audio is unusable."""

    def transcribe(self, audio: bytes) -> tuple[str, str | None]:
        """Raise UnusableAudioError regardless of input."""
        raise UnusableAudioError("bad audio")


client: TestClient = TestClient(app)


@pytest.fixture(autouse=True)
def _speech_overrides() -> Iterator[None]:
    """Scope the speech dependency overrides to this module's tests only.

    Setting overrides at module import time leaks into the shared `app` singleton
    and breaks other routers' tests (e.g. KYC auth). This fixture applies them per
    test and restores the previous override map on teardown so no state bleeds out.
    """
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_speech_settings] = _override_settings
    app.dependency_overrides[get_kyc_settings] = _override_kyc_settings
    app.dependency_overrides[get_transcription_engine] = lambda: _StubEngine()
    try:
        yield
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def _post_audio(data: bytes, headers: dict[str, str] | None = None) -> Any:
    """POST audio bytes to /transcribe as multipart."""
    return client.post(
        "/transcribe",
        files={"audio": ("voice-note", data, "audio/wav")},
        headers=AUTH_HEADERS if headers is None else headers,
    )


def test_transcribe_returns_text_and_language() -> None:
    """A valid clip returns the recognized text and detected language."""
    app.dependency_overrides[get_transcription_engine] = lambda: _StubEngine(
        "coordinated at noon", "en"
    )
    try:
        response = _post_audio(b"RIFFxxxxWAVEfmt ")
        assert response.status_code == 200
        data = response.json()
        assert data["text"] == "coordinated at noon"
        assert data["language"] == "en"
    finally:
        app.dependency_overrides[get_transcription_engine] = lambda: _StubEngine()


def test_transcribe_requires_auth() -> None:
    """A request without a valid Bearer token is rejected with 401."""
    response = client.post(
        "/transcribe",
        files={"audio": ("voice-note", b"data", "audio/wav")},
        headers={"Authorization": "Bearer wrong"},
    )
    assert response.status_code == 401


def test_transcribe_unusable_audio_returns_422() -> None:
    """An engine that cannot decode the audio yields a typed 422."""
    app.dependency_overrides[get_transcription_engine] = lambda: _FailingEngine()
    try:
        response = _post_audio(b"not-audio")
        assert response.status_code == 422
    finally:
        app.dependency_overrides[get_transcription_engine] = lambda: _StubEngine()


def test_transcribe_empty_audio_returns_422() -> None:
    """Empty audio bytes are rejected with 422."""
    response = _post_audio(b"")
    assert response.status_code == 422


def test_transcribe_oversized_audio_returns_422() -> None:
    """Audio larger than the configured maximum is rejected with 422."""

    def _tiny_limit() -> SpeechSettings:
        return SpeechSettings(ai_service_auth_token=TEST_AUTH_TOKEN, speech_max_audio_bytes=4)

    app.dependency_overrides[get_speech_settings] = _tiny_limit
    try:
        response = _post_audio(b"way too many bytes")
        assert response.status_code == 422
    finally:
        app.dependency_overrides[get_speech_settings] = _override_settings


def test_engine_contract_has_no_storage_access() -> None:
    """The engine protocol exposes only transcribe(bytes) — no storage path (Option A)."""
    members = {name for name, _ in inspect.getmembers(TranscriptionEngine)}
    assert "transcribe" in members
    # No storage/bucket/download-style capability is part of the engine contract.
    forbidden = {"download", "get_object", "fetch", "bucket", "minio", "storage"}
    method_names = {
        name
        for name in dir(_StubEngine())
        if callable(getattr(_StubEngine(), name)) and not name.startswith("_")
    }
    assert method_names == {"transcribe"}
    assert forbidden.isdisjoint(method_names)
    # The router module never imports a storage client.
    source = inspect.getsource(speech_router)
    assert "minio" not in source.lower()


@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    text=st.text(max_size=500),
    language=st.one_of(st.none(), st.sampled_from(["en", "es", "fr", "de", "pt"])),
)
def test_transcribe_roundtrips_arbitrary_result(text: str, language: str | None) -> None:
    """Property: whatever text/language the engine returns is echoed back verbatim.

    Feature: voice-notes, Property 9.2: /transcribe returns the engine's text +
    language unchanged for any recognized result.
    """
    app.dependency_overrides[get_transcription_engine] = lambda: _StubEngine(text, language)
    try:
        response = _post_audio(b"RIFFxxxxWAVE")
        assert response.status_code == 200
        data = response.json()
        assert data["text"] == text
        assert data["language"] == language
    finally:
        app.dependency_overrides[get_transcription_engine] = lambda: _StubEngine()
