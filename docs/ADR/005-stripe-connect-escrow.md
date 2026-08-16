# ADR-005: Stripe Connect for Escrow Payments

## Status
Accepted

## Context
BidClean needs a payment system that: charges the Host immediately on service acceptance, holds funds securely until service completion, releases payment to the Cleaner on satisfaction, supports multi-currency (COP, USD, CAD, EUR, GBP), and handles refunds/disputes.

## Decision
We chose Stripe Connect with platform-managed escrow.

## Reasoning
- **Escrow built-in** — Charge Host → hold on platform account → Transfer to Cleaner on confirmation.
- **Multi-currency native** — Connected accounts can be in any supported country/currency.
- **$250 credits from Shipaton** — Covers fees during hackathon period.
- **Stripe Projects integration** — Required for the $250 credits and Funnel Vision Award eligibility.
- **Global compliance** — PCI DSS handled by Stripe, we never touch card data.
- **Connected Accounts** — Each Cleaner gets their own Stripe account for payouts.
- **Tax reporting** — Stripe generates 1099s for US cleaners automatically.
- **Local payment methods** — PSE (Colombia), SEPA (Europe), etc.

## Payment Flow
1. Host publishes offer, Cleaner accepts.
2. Create PaymentIntent → charge Host's card immediately → funds held on platform.
3. Cleaner completes service.
4. Host confirms (or auto-release after 24h).
5. Create Transfer → funds move to Cleaner's Connected Account (minus commission).

## Fees
- Processing: 2.9% + $0.30 per charge (standard US)
- Connect payout: 0.25% + $0.25 per payout
- Monthly active account: $2/account with payouts that month
- All fees absorbed by BidClean from its 13% commission.

## Alternatives Considered
- **PayPal:** Higher fees, worse developer experience, less customizable.
- **Manual bank transfers:** No escrow, no protection, compliance nightmare.
- **Crypto escrow:** Too niche for our target market.

## Consequences
- Cleaners must complete Stripe onboarding (KYC within Stripe).
- 2-3 business days for first payouts (standard Stripe timing).
- Stripe fees reduce our net margin from 13% to ~9.3%.
- Disputes can be handled via Stripe's dispute system as backup.
