# Arrival Verification (Spec 18 — mobile)

## Purpose

The on-arrival identity-check UX for both roles. The **Cleaner** records a short arrival clip and
uploads it (grant → PUT MinIO → finalize); the **Host** sees only a derived result indicator
(recording / checking / verified / needs-review / unavailable) — never the raw footage and never the
raw score. The comparison is advisory and never blocks either party from proceeding.

## Files

| File | Responsibility |
|------|---------------|
| `verification.types.ts` | State, classification, display-status, and view types (no score/video-URL field). |
| `verification.constants.ts` | Endpoints, the `EXPO_PUBLIC_*` max-duration pre-check, dark tokens, i18n keys, `classify`/`toDisplayStatus`. |
| `verification.api.ts` | Typed HTTP: `getVerification`, and the composed `uploadArrivalClip` (request-upload → PUT → finalize). |
| `verification.store.ts` | Zustand store: idempotent non-regressing state application, `reconcile` via GET, upload flag. |
| `useArrivalRecorder.ts` | expo-camera recording, camera/mic permission (graceful denial), client-side max-duration pre-check. |
| `ArrivalVerificationScreen.tsx` | Cleaner: instruction + camera + record/stop; permission explainer; unobtrusive uploading state. |
| `ArrivalVerificationIndicator.tsx` | Host: result badge; `needs-review` shows a dispute path (no accusation/auto-cancel). |
| `components/RecordButton.tsx` | Accent record/stop CTA (disabled without permission / while uploading). |
| `components/ResultBadge.tsx` | The single derived-status indicator (never footage/score). |

## Dependencies

- Backend `video-verifications` endpoints (via the shared `apiClient`).
- `expo-camera` (recording + camera/mic permission).
- `react-i18next` (all copy), `zustand` (store), `react-native-safe-area-context`.

## Configuration

- `EXPO_PUBLIC_VIDEO_VERIFICATION_MAX_DURATION_MS` — UX max-duration pre-check only (the server is
  authoritative). No secrets are embedded.

## Design tokens & i18n

BidClean dark tokens: accent `#00F5D4` (record CTA), background `#0B0C10`, card `#1F2833`, text
`#FFFFFF`. All strings come from `i18n/locales/{en,es}/verification.json` (en/es parity, enforced by
a test).

## Privacy notes

- The store/view never holds a video URL or the raw `match_score` — the Host sees only a derived
  classification (REQ-VV15).
- Camera/mic permission denial degrades gracefully (i18n explainer, never crashes, never hard-blocks
  the service).
