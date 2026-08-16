"""BidClean AI Microservice — Entry point.

Provides endpoints for:
- Identity verification (KYC): document OCR + face comparison
- Translation: text and voice message translation
- Speech: speech-to-text and text-to-speech
- Pricing: AI-powered price estimation for cleaning services
"""

from fastapi import FastAPI

from src.health.router import router as health_router

app = FastAPI(
    title="BidClean AI Service",
    description="AI/ML microservice for verification, translation, speech, and pricing",
    version="0.1.0",
)

app.include_router(health_router)

# Feature routers will be added here:
# app.include_router(verification_router, prefix="/verification", tags=["verification"])
# app.include_router(translation_router, prefix="/translation", tags=["translation"])
# app.include_router(speech_router, prefix="/speech", tags=["speech"])
# app.include_router(pricing_router, prefix="/pricing", tags=["pricing"])
