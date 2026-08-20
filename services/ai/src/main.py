"""BidClean AI Microservice — Entry point.

Provides endpoints for:
- Identity verification (KYC): document OCR + face comparison + liveness
- Translation: text and voice message translation
- Speech: speech-to-text and text-to-speech
- Pricing: AI-powered price estimation for cleaning services
"""

import uuid

from fastapi import FastAPI, Request, Response

from src.health.router import router as health_router
from src.kyc.router import router as kyc_router

app = FastAPI(
    title="BidClean AI Service",
    description="AI/ML microservice for verification, translation, speech, and pricing",
    version="0.1.0",
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next: object) -> Response:
    """Propagate or generate X-Request-ID for correlation.

    If the incoming request has an X-Request-ID header, it is preserved
    in the response. Otherwise, a new UUID is generated and attached.
    """
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    response: Response = await call_next(request)  # type: ignore[misc]
    response.headers["X-Request-ID"] = request_id
    return response


app.include_router(health_router)
app.include_router(kyc_router)

# Feature routers will be added here:
# app.include_router(translation_router, prefix="/translation", tags=["translation"])
# app.include_router(speech_router, prefix="/speech", tags=["speech"])
# app.include_router(pricing_router, prefix="/pricing", tags=["pricing"])
