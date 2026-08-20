"""KYC (Know Your Customer) verification module.

Provides AI-powered identity verification endpoints:
- OCR: Extract text and face from identity documents (PaddleOCR)
- Face comparison: Compare selfie vs document photo (DeepFace)
- Liveness detection: Detect presentation attacks / spoofing (Silent-Face)

All endpoints require service-to-service Bearer token authentication
and propagate X-Request-ID for correlation.
"""
