"""Health check endpoint for liveness and readiness probes."""

from fastapi import APIRouter

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/", summary="Health check")
async def health_check() -> dict[str, str]:
    """Return service health status.

    Used by Docker, load balancers, and monitoring tools
    to verify the AI service is running and responsive.
    """
    return {"status": "healthy", "service": "bidclean-ai"}
