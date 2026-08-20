"""Service-to-service authentication dependency for KYC endpoints.

Validates Bearer token from the Authorization header against the
configured AI_SERVICE_AUTH_TOKEN. Extracts X-Request-ID for correlation.
"""

import logging

from fastapi import Depends, Header, HTTPException, status

from src.kyc.config import KYCSettings, get_kyc_settings

logger = logging.getLogger(__name__)


async def verify_service_token(
    authorization: str | None = Header(default=None),
    x_request_id: str | None = Header(default=None, alias="X-Request-ID"),
    settings: KYCSettings = Depends(get_kyc_settings),
) -> str | None:
    """Validate service-to-service Bearer token.

    Compares the Authorization header token against the configured
    AI_SERVICE_AUTH_TOKEN. Logs correlation ID for request tracing.

    Args:
        authorization: Authorization header value (Bearer <token>).
        x_request_id: Correlation ID from the calling service.
        settings: KYC configuration with the expected auth token.

    Returns:
        The X-Request-ID if provided, None otherwise.

    Raises:
        HTTPException: 401 if token is missing, malformed, or invalid.
    """
    if x_request_id:
        logger.info("Processing request with correlation ID: %s", x_request_id)

    if not authorization:
        logger.warning("Request missing Authorization header (request_id=%s)", x_request_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    parts = authorization.split(" ", maxsplit=1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        logger.warning("Malformed Authorization header (request_id=%s)", x_request_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format. Expected: Bearer <token>",
        )

    token = parts[1]
    if token != settings.ai_service_auth_token:
        logger.warning("Invalid token provided (request_id=%s)", x_request_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        )

    return x_request_id
