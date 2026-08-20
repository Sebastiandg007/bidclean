# KYC Screens

## Purpose

Identity verification (Know Your Customer) screens for BidClean Cleaners. This module provides the UI for document capture, selfie capture with liveness detection, and verification status display. Cleaners must complete KYC before accepting any offers.

## Flow

```
Cleaner Onboarding / Banner CTA
  → DocumentCaptureScreen (capture ID photo + quality check)
  → SelfieCaptureScreen (front camera + face overlay)
  → KycStatusScreen (processing / verified / rejected + retry)
```

## Files

| File | Responsibility |
|------|---------------|
| `DocumentCaptureScreen.tsx` | Camera interface for capturing identity documents with quality validation |
| `SelfieCaptureScreen.tsx` | Front-facing camera for selfie capture with face-shaped overlay and single face validation |
| `KycStatusScreen.tsx` | Displays current KYC status with retry option when rejected |
| `useKyc.ts` | Custom hook for KYC business logic (upload, status polling, retry) |
| `kyc.types.ts` | Shared types for KYC screens (status, props, API responses) |
| `kyc.constants.ts` | Design tokens, quality thresholds, environment-derived config |
| `components/DocumentOverlay.tsx` | Camera overlay showing correct document positioning frame |
| `components/FaceOverlay.tsx` | Oval face-shaped overlay with detection feedback (accent/error border states) |
| `components/QualityFeedback.tsx` | Real-time quality feedback (blur, lighting, positioning) |

## Tests

| File | Coverage |
|------|----------|
| `__tests__/DocumentCaptureScreen.spec.tsx` | Camera permission, overlay rendering, quality feedback |
| `__tests__/SelfieCaptureScreen.spec.tsx` | Front camera, face overlay, single face validation |
| `__tests__/KycStatusScreen.spec.tsx` | Status display per state, retry button visibility |

## Dependencies

- `expo-camera` — Document and selfie capture
- `expo-image-manipulator` — Client-side image quality validation (blur, resolution)
- `react-native-reanimated` — Capture UI animations (overlays, feedback transitions)
- `react-native-safe-area-context` — Safe area wrapper
- `expo-router` — Navigation between KYC steps
- Zustand store extension — KYC state management
- API service (`src/services/api.service.ts`) — Upload endpoints, status polling

## API Endpoints Used

| Method | Path | Description |
|--------|------|-------------|
| POST | `/kyc/document` | Upload captured document image |
| POST | `/kyc/selfie` | Upload captured selfie image |
| GET | `/kyc/status` | Poll current verification status |
| POST | `/kyc/retry` | Start a new verification attempt |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `KYC_MIN_IMAGE_WIDTH` | Minimum image width for quality validation | Yes |
| `KYC_MIN_IMAGE_HEIGHT` | Minimum image height for quality validation | Yes |
| `KYC_MAX_FILE_SIZE_MB` | Maximum upload file size | Yes |
| `KYC_MAX_ATTEMPTS` | Maximum selfie capture retry attempts | Yes |

## Design System

Uses the BidClean design system tokens (see `src/theme/`):
- Dark mode background, accent color for CTAs, container surfaces
- Overlays use semi-transparent borders with accent on alignment
- All UI text uses i18n keys (prefix: `kyc.*`)

## State Machine

```
NOT_STARTED → DOCUMENT_UPLOADED → SELFIE_UPLOADED → PROCESSING → VERIFIED / REJECTED
```

- State is polled via `GET /kyc/status`
- Rejected status shows retry button (up to max attempts)
- Verified status unlocks offer acceptance
