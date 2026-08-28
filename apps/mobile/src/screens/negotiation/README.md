# Negotiation Screens (Mobile)

## Purpose

The Cleaner and Host UI for offer negotiation. Cleaners accept an offer at the Host's price or submit a counteroffer and track its status; Hosts review incoming counteroffers and accept/reject/counter them. Also powers the radar's Quick Accept. The backend is authoritative; client-side deviation bounds and payout preview are UX only.

## Files

| File | Responsibility |
|------|---------------|
| `useNegotiation.ts` | Zustand store: cleaner + host actions, version/eventId-gated real-time handling, payout preview |
| `negotiation.api.ts` | Typed HTTP client; attaches `Idempotency-Key` (expo-crypto) to every mutation |
| `negotiation.types.ts` | Proposal/thread/inbox/event interfaces |
| `negotiation.constants.ts` | Routes, endpoints, i18n error keys, deviation-bounds mirror |
| `negotiation.format.ts` | Locale + currency money formatting |
| `CleanerNegotiationScreen.tsx` | Accept / counteroffer, live payout, proposal status, Host counter-back accept/decline |
| `HostCounterofferInboxScreen.tsx` | Inbox of pending Cleaner counteroffers, grouped by offer |
| `components/AcceptBar.tsx` | Accept-at-Host-price action (offline-disabled) |
| `components/CounterofferInput.tsx` | Price entry + live payout + Base Price bounds guard |
| `components/CounterBackInput.tsx` | Host counter-back price entry |
| `components/PayoutPreview.tsx` | Cleaner payout / Host total preview |
| `components/ProposalStatusBadge.tsx` | Localized proposal status badge |
| `components/HostCounterofferCard.tsx` | One inbox item with accept/reject/counter actions |

## Dependencies

- Shared `apiClient` (`services/api.service`) — lazy-imported.
- `expo-crypto` for idempotency keys.
- i18n namespace `negotiation` (`i18n/locales/{en,es}/negotiation.json`).
- Integrates with the radar's `useRadarStore` (Quick Accept removes matched offers).

## Real-Time

`handleNegotiationEvent` dedups by `eventId` and gates by thread `version` (stale events discarded), then re-fetches from REST (authoritative) to reconcile.

## Quick Accept Integration

`OfferPreviewSheet.handleQuickAccept` (radar) calls `useNegotiation().acceptOffer(offerId)`. It is disabled offline; on success or a 409 stale offer, the offer is removed from the radar and the sheet dismissed. No client-side eligibility logic — the backend revalidates.
