"""Tests for the health check endpoint."""

from fastapi.testclient import TestClient

from src.main import app

client = TestClient(app)


def test_health_check_returns_200() -> None:
    """Health endpoint responds with 200 and correct payload."""
    response = client.get("/health/")

    assert response.status_code == 200


def test_health_check_payload_structure() -> None:
    """Health endpoint returns expected JSON structure."""
    response = client.get("/health/")
    data = response.json()

    assert data["status"] == "healthy"
    assert data["service"] == "bidclean-ai"


def test_health_check_content_type() -> None:
    """Health endpoint returns JSON content type."""
    response = client.get("/health/")

    assert response.headers["content-type"] == "application/json"
