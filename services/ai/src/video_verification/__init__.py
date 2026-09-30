"""Video-verification AI package (Spec 18).

Exposes ``POST /verify-face``: an on-arrival face-comparison endpoint that compares a candidate
arrival-video frame against a reference KYC selfie via DeepFace (Option A — the AI service receives
BYTES and has NO storage credentials). Face embeddings exist only in memory and are never persisted.
"""
