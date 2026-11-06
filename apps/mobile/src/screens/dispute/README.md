# dispute (mobile, Spec 21)

## Purpose

The Host and Cleaner dispute UX. The Host raises a dispute (reason + optional text + grant-gated evidence photos — the case itself is created by Spec 20's routing, **never a direct `POST /disputes`**), sees the dispute as OPEN with a visible resolution deadline, and the outcome once resolved. The Cleaner sees the dispute state, adds counter-evidence within the window, an explicit "auto-release paused" indicator, and the outcome + payment effect. `GET` reconciliation is authority; the countdown is a display of the durable server deadline (never an authoritative client timer).

## Files

| File | Responsibility |
|------|----------------|
| `dispute.types.ts` | Mobile mirror of the backend dispute view + evidence refs (no internal intent fields) |
| `dispute.constants.ts` | Endpoints, i18n keys, dark tokens, `EXPO_PUBLIC_DISPUTE_EVIDENCE_MAX_SIZE_BYTES` (UX pre-check only) |
| `dispute.api.ts` | GET / request-upload → PUT → finalize / add-note / evidence-url. **No create** |
| `dispute.store.ts` | Zustand store; optimistic evidence reconciled via `GET`; never persists a bare object key |
| `useResolutionCountdown.ts` | Display-only countdown from the durable deadline; re-fetches via `GET` on expiry |
| `DisputeHostScreen.tsx` | Host: status badge, countdown, reason picker, evidence upload, outcome |
| `DisputeCleanerScreen.tsx` | Cleaner: status, auto-release-paused indicator, note + photo evidence, outcome |
| `EvidenceGallery.tsx` | Participant/resolver-gated evidence viewing (fresh URLs / gated data) |
| `components/DisputeStatusBadge.tsx` | Dispute-state indicator |
| `components/ReasonPicker.tsx` | Reason code chips + optional text |
| `components/EvidenceUploader.tsx` | Grant-gated photo upload via `expo-image-picker` |
| `components/OutcomeSummary.tsx` | Favor-cleaner/host/partial + payment effect |

## Dependencies

- Shared `apiClient` (`services/api.service`), `expo-image-picker`, `react-i18next`, `zustand`.
- Backend `dispute-system` (Spec 21) endpoints.

## i18n

`i18n/locales/en/dispute.json` and `es/dispute.json` (key parity enforced by a test). All UI copy uses `dispute.*` keys.

## Design tokens

Dark BidClean tokens: accent `#00F5D4` (dispute/submit CTAs), background `#0B0C10`, cards `#1F2833`. Evidence photos are only viewable by authorized parties.

## How to run (tests)

```
cd apps/mobile
npx jest src/screens/dispute
```
