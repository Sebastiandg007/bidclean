# completion screens (Spec 20)

## Purpose

The mobile completion UX for both roles. The **Host** confirms satisfaction, opens a dispute, and
sees an auto-release countdown; the **Cleaner** sees the release status (released / pending payout /
disputed) and both rate each other. `GET` reconciliation is authoritative; realtime is advisory; the
countdown is a display of the durable server deadline, never an authoritative client timer.

## Files

| File | Responsibility |
|------|---------------|
| `completion.types.ts` | Mobile domain types mirroring the backend view (no internal intent fields). |
| `completion.constants.ts` | Endpoints, routes, rating bounds (UX), dark tokens, i18n keys. |
| `completion.api.ts` | Typed HTTP access (`getCompletion` / `confirm` / `dispute` / `postReleaseDispute` / `submitRating` / `getRatings`). |
| `completion.store.ts` | Zustand store: optimistic confirm/dispute reconciled via `GET`, idempotent state application. |
| `useAutoReleaseCountdown.ts` | Display-only countdown from the durable deadline; re-fetches via `GET` on expiry. |
| `CompletionHostScreen.tsx` | Host: confirm / dispute + countdown + rating prompt; paused indicator on dispute. |
| `CompletionCleanerScreen.tsx` | Cleaner: release-status badge (from `releaseStatus`) + rating prompt. |
| `components/AutoReleaseCountdown.tsx` | Renders the remaining time / "releasing…". |
| `components/ConfirmDisputeActions.tsx` | Host confirm (accent CTA) + dispute action. |
| `components/ReleaseStatusBadge.tsx` | Cleaner release status from `(state, releaseStatus)`. |
| `components/RatingSheet.tsx` | Stars 1..5 + optional comment; thanks state once rated. |

## Dependencies

- Shared `apiClient` (`../../services/api.service`), lazy-imported.
- `react-i18next` for copy; namespace `completion` (`i18n/locales/{en,es}/completion.json`).
- BidClean dark tokens: accent `#00F5D4`, card `#1F2833`, background `#0B0C10`.

## How to Run

Mount `CompletionHostScreen` / `CompletionCleanerScreen` from the finished-job entry point in each
role navigator with `route.params.completionId`. Verified locally with `tsc --noEmit`, ESLint, and
`jest src/screens/completion`.
