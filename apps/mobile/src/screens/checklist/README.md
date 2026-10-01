# checklist screens (Spec 19)

## Purpose

The mobile checklist UX for both roles. The **Cleaner** works the snapshotted checklist while the
session is `IN_PROGRESS`: toggling tasks and attaching before/after photo evidence. The **Host**
observes live-ish `X/Y` progress (best-effort realtime, authoritative via `GET`) and views attached
evidence (participant-gated). Photo capture handles camera-permission denial gracefully and never
hard-blocks completing tasks that don't require a photo. All copy is i18n (`en`/`es` parity); dark
BidClean tokens (`#00F5D4` accent, `#0B0C10` background, `#1F2833` cards).

## Files

| File | Responsibility |
|------|---------------|
| `checklist.types.ts` | Mobile domain types (run/task/photo ref, captured photo) |
| `checklist.constants.ts` | Endpoints, i18n keys, dark tokens, `EXPO_PUBLIC_CHECKLIST_PHOTO_MAX_SIZE_BYTES` pre-check |
| `checklist.api.ts` | Typed HTTP; the upload flow (request → PUT to MinIO → finalize) composed as one action; playback-url |
| `checklist.store.ts` | Zustand store: optimistic toggle + evidence, reconcile via `GET`, never holds a bare object key |
| `usePhotoCapture.ts` | `expo-image-picker` camera capture + client-side max-size pre-check + graceful permission handling |
| `ChecklistScreen.tsx` | Cleaner: tasks + capture + finalize affordance (surfaces unmet preconditions) |
| `ChecklistProgressScreen.tsx` | Host: read-only progress + evidence viewing |
| `components/TaskRow.tsx` | One task row (toggle + add-photo in Cleaner mode; read-only in Host mode) + evidence thumbs |
| `components/EvidenceThumb.tsx` | Tappable evidence reference (fetches a fresh playback URL on demand) |
| `components/ProgressBar.tsx` | `X/Y` progress indicator |

## Dependencies

- Backend `service-sessions/:id/checklist` endpoints (Spec 19).
- Shared `apiClient` (`services/api.service`), `zustand`, `react-i18next`, `expo-image-picker`.
- i18n bundles: `src/i18n/locales/{en,es}/checklist.json`.

## Notes

- The store never persists an object key — only photo references (id/kind/uploadedAt). Playback URLs
  are fetched on demand from the backend and never cached.
- Bytes are PUT directly to MinIO via the pre-signed URL from `request-upload`; they never transit
  the API.
- Client size pre-check is UX-only; the server is authoritative for size/type/dimensions.

## How to Run

Part of the Expo app. Tests: `npx jest src/screens/checklist`.
