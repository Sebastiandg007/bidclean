# Negotiation Screens

## Purpose

Offer negotiation flow for BidClean. When a Cleaner views a published offer they can either accept it directly at the Host's price or submit a counteroffer. Hosts receive Cleaner counteroffers in an inbox and can accept, reject, or counter back. A successful accept produces a match. This module provides the mobile state layer, API client, types, and constants that back the Cleaner negotiation screen and the Host counteroffer inbox.

The backend is authoritative for pricing, deviation bounds, and match outcomes. Client-side deviation checks and payout previews exist only for UX; every mutation carries an idempotency key.

## Flow

```
Cleaner side
  → OfferDetail (accept directly OR open counteroffer)
  → CleanerNegotiation (thread view: submit counteroffer, accept/decline Host counter-back)

Host side
  → HostCounterofferInbox (pending Cleaner proposals: accept / reject / counter back)

Real-time (Centrifugo): version/sequence-gated events reconcile the thread via REST
```

## Files

| File | Responsibility |
|------|---------------|
| `CleanerNegotiationScreen.tsx` | Cleaner accept / counteroffer screen for a single offer. Renders the accept-at-Host-price bar, counteroffer input with live payout, current proposal status, and Host counter-back accept/decline. Direct Accept supersedes an open PENDING counteroffer |
| `useNegotiation.ts` | Zustand store (`useNegotiationStore`) + `useNegotiation()` hook. Cleaner and Host actions, real-time event handling with dedup and version gating, derived payout preview, deviation-bounds check |
| `negotiation.api.ts` | Typed HTTP client for negotiation endpoints; attaches a crypto-random `Idempotency-Key` (expo-crypto) to every mutation |
| `negotiation.types.ts` | Shared TypeScript types (ProposalView, ThreadView, MatchSummary, AcceptResult, HostInboxItem, Breakdown, NegotiationEvent) |
| `negotiation.constants.ts` | Route names, endpoint builders, i18n error keys, idempotency header, deviation-bounds mirror + helpers |
| `negotiation.format.ts` | Locale-aware currency formatting helper (`formatMoney`) for the negotiation UI; formats integer cents per the offer currency |

## Components

Presentational components for the Cleaner negotiation screen and Host counteroffer inbox. All text uses `negotiation.*` i18n keys, prices are integer cents formatted via `negotiation.format.ts`, and colors follow the BidClean design tokens.

| File | Responsibility |
|------|---------------|
| `components/AcceptBar.tsx` | "Accept at Host price" action bar; disabled offline (acceptance needs server revalidation), with an optional hint that accepting supersedes an open counteroffer |
| `components/CounterofferInput.tsx` | Price entry with live payout preview and Base Price deviation-bounds guard; blocks submitting a price outside the allowed range (backend authoritative) |
| `components/PayoutPreview.tsx` | Presentation-only display of the Cleaner payout and Host total for a given price, formatted per locale and offer currency |
| `components/ProposalStatusBadge.tsx` | Small colored badge showing a proposal's status (PENDING/ACCEPTED/REJECTED/COUNTERED/SUPERSEDED/EXPIRED), localized via i18n |

## Dependencies

- `zustand` — Negotiation state management (`useNegotiationStore`)
- `expo-crypto` — Cryptographically random idempotency keys
- API service (`src/services/api.service.ts`) — Shared Axios client (lazy import to avoid circular deps)
- Offers module — Consumes the `OFFER_MATCH` contract when a negotiation matches
- Backend Negotiation module (`services/api/src/negotiation/`) — Authoritative proposal/thread/match model

## API Endpoints Used

| Method | Path | Description |
|--------|------|-------------|
| POST | `/negotiation/offers/:offerId/accept` | Cleaner accepts an offer at the Host's price |
| POST | `/negotiation/offers/:offerId/counteroffers` | Cleaner submits a counteroffer |
| POST | `/negotiation/proposals/:proposalId/accept` | Accept a PENDING proposal (Host accepts Cleaner, or Cleaner accepts Host counter-back) |
| POST | `/negotiation/proposals/:proposalId/reject` | Reject a PENDING proposal |
| POST | `/negotiation/proposals/:proposalId/counter` | Counter back with a new price |
| GET | `/negotiation/offers/:offerId/thread` | Fetch the Cleaner's thread for an offer |
| GET | `/negotiation/host/counteroffers` | Fetch the Host's counteroffer inbox |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `EXPO_PUBLIC_NEGOTIATION_MIN_DEVIATION_BPS` | Client mirror of the min price deviation (basis points) below Base Price. Defaults to `2000`. Server remains authoritative | No |
| `EXPO_PUBLIC_NEGOTIATION_MAX_DEVIATION_BPS` | Client mirror of the max price deviation (basis points) above Base Price. Defaults to `2000`. Server remains authoritative | No |

## State Management

```
Zustand Store: useNegotiationStore (useNegotiation.ts)
├── State
│   ├── myThreads: Map<offerId, ThreadView>   (Cleaner-side threads)
│   ├── inbox: HostInboxItem[]                 (Host-side pending counteroffers)
│   ├── processedEventIds: Set<string>         (real-time dedup)
│   ├── isSubmitting / isLoadingInbox
│   └── error: string | null (i18n key)
├── Cleaner actions
│   ├── acceptOffer(offerId)
│   ├── submitCounteroffer(offerId, priceCents)
│   ├── acceptHostCounter(proposalId) / declineHostCounter(proposalId)
│   └── fetchThread(offerId)
├── Host actions
│   ├── fetchInbox()
│   ├── acceptCounteroffer(proposalId) / rejectCounteroffer(proposalId)
│   └── counterBack(proposalId, priceCents)
├── Real-time
│   └── handleNegotiationEvent(event) — dedup by eventId, version-gate, then REST reconcile
└── Derived (server authoritative)
    ├── computePreviewPayout(price, hostFeeBps, cleanerBps, currency)
    └── isWithinBounds(basePriceCents, priceCents)
```

## Design System

Uses the BidClean design system tokens (see `src/theme/`):
- Dark mode background, accent color for CTAs and price highlights
- All UI text uses i18n keys (prefix: `negotiation.*`)
- Prices are integer cents, formatted per locale + offer currency
- Animations: Reanimated 3 with spring physics
