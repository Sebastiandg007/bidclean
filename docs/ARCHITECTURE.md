# BidClean — Architecture

> **This document MUST be updated on every structural change.** If you add, remove, or modify a service, module, or integration, update the corresponding diagram.

---

## 1. System Architecture (High Level)

```mermaid
graph TB
    subgraph Clients["📱 Client Applications"]
        Mobile["React Native + Expo<br/>(iOS / Android / Galaxy)"]
        Web["Next.js<br/>(bidclean.tech)"]
    end

    subgraph Gateway["🔒 Gateway Layer"]
        Traefik["Traefik<br/>Reverse Proxy + SSL"]
    end

    subgraph Core["⚙️ Core Services"]
        API["NestJS API<br/>(TypeScript)"]
        AI["FastAPI AI Service<br/>(Python)"]
    end

    subgraph Realtime["⚡ Realtime"]
        Centrifugo["Centrifugo<br/>(WebSocket Chat + Tracking)"]
        LiveKit["LiveKit<br/>(VoIP + Video)"]
    end

    subgraph Data["💾 Data Layer"]
        Postgres["PostgreSQL + PostGIS"]
        Redis["Redis<br/>(Cache + Queues)"]
        MinIO["MinIO<br/>(Object Storage)"]
    end

    subgraph Auth["🔐 Authentication"]
        Keycloak["Keycloak<br/>(OAuth2 / OIDC)"]
    end

    subgraph AIModels["🤖 AI/ML"]
        LibreTranslate["LibreTranslate"]
        Whisper["Whisper.cpp"]
        Piper["Piper TTS"]
        DeepFace["DeepFace"]
        PaddleOCR["PaddleOCR"]
    end

    subgraph External["☁️ External Services"]
        Stripe["Stripe Connect<br/>(Payments + Escrow)"]
        RevenueCat["RevenueCat<br/>(Subscriptions + Ad Revenue Tracking)"]
        AdMob["Google AdMob<br/>(Display Ads — free tier)"]
        OneSignal["OneSignal<br/>(Push Notifications)"]
        Mapbox["Mapbox<br/>(Maps + Directions)"]
        Bedrock["AWS Bedrock<br/>(AI Models)"]
    end

    subgraph Monitoring["📊 Observability"]
        Prometheus["Prometheus"]
        Grafana["Grafana"]
        Loki["Loki (Logs)"]
        Sentry["Sentry"]
        Posthog["Posthog (Analytics)"]
        Metabase["Metabase (BI)"]
    end

    Mobile --> Traefik
    Web --> Traefik
    Traefik --> API
    Traefik --> Centrifugo
    Traefik --> LiveKit
    API --> Postgres
    API --> Redis
    API --> MinIO
    API --> Keycloak
    API --> AI
    API --> Centrifugo
    API --> Stripe
    API --> RevenueCat
    API --> OneSignal
    AI --> LibreTranslate
    AI --> Whisper
    AI --> Piper
    AI --> DeepFace
    AI --> PaddleOCR
    AI --> Bedrock
    API --> Prometheus
    Prometheus --> Grafana
    API --> Loki
    Mobile --> Posthog
    Mobile --> Sentry
    Mobile --> AdMob
    Mobile --> RevenueCat
```

---

## 2. Frontend Architecture

```mermaid
graph TB
    subgraph App["📱 React Native + Expo"]
        subgraph Navigation["Navigation (Expo Router)"]
            RoleRouter["RoleBasedNavigator<br/>(role → navigator)"]
            AuthStack["Auth Stack<br/>(Login, Register, KYC)"]
            HostTabs["Host Tabs<br/>(Home, Properties, Activity, Profile)"]
            CleanerTabs["Cleaner Tabs<br/>(Radar, Active, Profile)"]
        end

        subgraph Screens["Screens (by feature)"]
            Radar["Radar Screen<br/>(Map + Offers)"]
            OfferDetail["Offer Detail"]
            Negotiation["Cleaner Negotiation<br/>(Accept / Counteroffer)"]
            Service["Service In Progress"]
            Chat["Chat Screen"]
            PropertyEdit["Property Editor"]
            PaymentStatus["Payment Status<br/>(Breakdown + Refund)"]
            PayoutOnboarding["Cleaner Payout Onboarding<br/>(Stripe Express)"]
            Paywall["Paywall Screen<br/>(Cleaner PRO / Host PRO)"]
        end

        subgraph Stores["Zustand Stores"]
            AuthStore["useAuthStore"]
            RoleStore["useRoleStore"]
            OffersStore["useOffersStore"]
            RadarStore["useRadarStore"]
            NegotiationStore["useNegotiationStore"]
            PaymentsStore["usePaymentsStore"]
            ServiceStore["useServiceStore"]
            ChatStore["useChatStore"]
            SettingsStore["useSettingsStore"]
        end

        subgraph Services["Services Layer"]
            APIService["API Client (Axios)"]
            SocketService["WebSocket (Centrifugo)"]
            MapService["Mapbox Integration"]
            NotifService["OneSignal SDK"]
            PurchaseService["RevenueCat SDK"]
            BiometricService["Biometric Auth"]
        end

        subgraph Theme["Design System"]
            Colors["Colors (Mint & Obsidian)"]
            Typography["Typography (Custom Font)"]
            Spacing["Spacing Tokens"]
            Components["Shared Components"]
        end
    end

    Navigation --> Screens
    RoleRouter --> HostTabs
    RoleRouter --> CleanerTabs
    Screens --> Stores
    Screens --> Services
    Screens --> Theme
    Services --> |"HTTP"| API["NestJS API"]
    Services --> |"WS"| WS["Centrifugo"]
```

---

## 3. Backend Architecture (NestJS)

```mermaid
graph TB
    subgraph API["NestJS API"]
        subgraph Modules["Feature Modules"]
            Auth["Auth Module"]
            Roles["Roles Module"]
            Users["Users Module"]
            Profile["Profile Module"]
            KYC["KYC Module"]
            Properties["Properties Module"]
            Offers["Offers Module"]
            Negotiation["Negotiation Module"]
            Payments["Payments Module"]
            Commission["Commission Module"]
            Chat["Chat Module"]
            Notifications["Notifications Module"]
            Subscriptions["Subscriptions Module"]
            Favorites["Favorites Module"]
        end

        subgraph Shared["Shared"]
            Guards["Auth Guards"]
            Interceptors["Logging / Transform"]
            Filters["Exception Filters"]
            Pipes["Validation Pipes (Zod)"]
        end

        subgraph Infra["Infrastructure"]
            DB["TypeORM / Prisma<br/>(PostgreSQL)"]
            Cache["Redis Service"]
            Queue["BullMQ Jobs"]
            Storage["MinIO Client"]
            Events["Event Emitter"]
        end
    end

    Users --> DB
    Roles --> DB
    Profile --> DB
    Profile --> Storage
    Profile --> Queue
    KYC --> DB
    KYC --> Storage
    KYC --> Queue
    Properties --> DB
    Properties --> Storage
    Offers --> DB
    Offers --> Cache
    Offers --> Queue
    Offers --> Events
    Negotiation --> DB
    Negotiation --> Queue
    Negotiation --> Events
    Negotiation --> |"OFFER_MATCH contract"| Offers
    Negotiation --> |"Centrifugo API"| Centrifugo
    Commission --> DB
    Commission --> |"cache invalidation"| Cache
    Offers --> |"COMMISSION_RATES: resolveHostRate (create)"| Commission
    Negotiation --> |"COMMISSION_RATES: resolveCleanerRate (match)"| Commission
    Payments --> DB
    Payments --> |"Stripe SDK"| Stripe["Stripe Connect"]
    Chat --> DB
    Chat --> Cache
    Chat --> |"Centrifugo API"| Centrifugo["Centrifugo"]
    Auth --> |"isParticipant (subscription-token gate)"| Chat
    Notifications --> |"OneSignal API"| OneSignal["OneSignal"]
    Subscriptions --> |"RevenueCat API"| RevenueCat["RevenueCat"]
    Events --> Notifications
    Events --> Chat
```

---

## 4. Offer Lifecycle (Data Flow)

```mermaid
sequenceDiagram
    participant H as Host
    participant App as BidClean API
    participant R as Redis
    participant OS as OneSignal
    participant C as Cleaner
    participant S as Stripe

    H->>App: Publish offer (property, price, time)
    App->>R: Store offer + start radius timer
    App->>OS: Push to Favorites (if any)
    
    Note over R: Wait 30s
    App->>OS: Push to PRO Cleaners (radius 2km)
    
    Note over R: Wait 30s  
    App->>OS: Push to FREE Cleaners (radius 2km)
    
    Note over R: Every 1 min: expand radius
    App->>OS: Push to Cleaners (expanded radius)

    C->>App: View offer details (1 min timer starts)
    C->>App: Accept or Counteroffer
    App->>H: Notify: "New counteroffer from Cleaner"
    H->>App: Accept Cleaner

    App->>S: Charge Host card (escrow)
    S-->>App: Payment captured + held

    App->>C: Notify: "Service confirmed, navigate to property"
    App->>H: Show Cleaner on map (real-time tracking)

    C->>App: Arrive (geofence triggered)
    App->>C: Activate video verification
    C->>App: Video uploaded + face matched

    C->>App: Complete checklist + upload photos
    App->>H: Notify: "Service completed, confirm satisfaction"

    alt Host confirms
        H->>App: Confirm satisfaction
        App->>S: Release payment to Cleaner (minus commission)
        S-->>C: Payout received
    else Host does not respond (24h)
        App->>S: Auto-release payment
        S-->>C: Payout received
    else Host disputes
        H->>App: Open dispute (reason + evidence)
        App->>App: Auto-resolve based on checklist + photos
    end
```

---

## 5. Payment Flow

```mermaid
graph LR
    subgraph Host["Host Pays"]
        Offer["Agreed Price: $100"]
        Fee["+ Service Fee 10%: $10"]
        Total["Total Charged: $110"]
    end

    subgraph Platform["BidClean Platform"]
        Escrow["Stripe Escrow<br/>(Holds $110)"]
        Commission["BidClean Commission<br/>$13 (10% host + 3% cleaner)"]
        StripeFee["Stripe Fees<br/>~$3.70"]
        NetRevenue["Net Revenue<br/>~$9.30"]
    end

    subgraph Cleaner["Cleaner Receives"]
        Payout["Net Payout: $97<br/>($100 - 3% commission)"]
    end

    Total --> Escrow
    Escrow --> |"On satisfaction"| Commission
    Escrow --> |"On satisfaction"| Payout
    Commission --> StripeFee
    Commission --> NetRevenue
```

---

## 5b. Payment Escrow Schema

> Physical schema for the Stripe Escrow module (migration `1700000014000-CreatePaymentTables`). Money is stored as integer minor units (cents); statuses use `VARCHAR` + `CHECK`.

```mermaid
erDiagram
    offers ||--o| payments : "one payment per offer"
    users ||--o{ payments : "host_id (RESTRICT)"
    users ||--o{ payments : "cleaner_id (RESTRICT)"
    payments ||--o{ payment_attempts : "1..N charge attempts (CASCADE)"
    payments ||--o{ payment_events : "audit ledger (CASCADE)"
    users ||--o| stripe_accounts : "one Express account per cleaner (CASCADE)"

    payments {
        uuid id PK
        uuid offer_id FK "UNIQUE (one per offer)"
        uuid host_id FK
        uuid cleaner_id FK
        varchar payment_status "PENDING..REFUNDED"
        varchar dispute_status "NONE|OPEN|WON|LOST"
        varchar payout_status "NOT_READY..REVERSED"
        char currency "ISO 4217"
        int agreed_price_cents
        int host_total_cents
        int cleaner_payout_cents
        int platform_gross_revenue_cents
        int refunded_amount_cents "<= host_total_cents"
        int reversed_amount_cents "<= cleaner_payout_cents"
        varchar stripe_transfer_id
        timestamptz held_at
        timestamptz released_at
    }

    payment_attempts {
        uuid id PK
        uuid payment_id FK
        int attempt_number "UNIQUE per payment"
        varchar stripe_payment_intent_id "UNIQUE"
        varchar stripe_charge_id
        varchar status "PROCESSING|SUCCEEDED|FAILED"
        int amount_cents
        char currency
    }

    stripe_accounts {
        uuid id PK
        uuid cleaner_id FK "UNIQUE"
        varchar stripe_account_id "UNIQUE (acct_...)"
        bool charges_enabled
        bool payouts_enabled
        bool details_submitted
        char country
        char default_currency
        timestamptz last_synced_at
    }

    payment_events {
        uuid id PK
        uuid payment_id FK "nullable"
        varchar source "api|webhook"
        varchar event_type
        varchar stripe_event_id "UNIQUE when set (webhook dedup)"
        varchar idempotency_key
        jsonb payload_json
    }
```

Invariants enforced at the database level: at most one `SUCCEEDED` attempt per payment (partial unique index), one payment per offer, refund/reversal ceilings via `CHECK`, and webhook idempotency via a partial unique index on `stripe_event_id`.

---

## 5c. Stripe Webhook Ingress

> Stripe events enter through a single public endpoint that is authenticated by the signature (not JWT). The controller verifies, deduplicates, persists, and enqueues — then a worker advances the payment lifecycle, which fans out the domain events in §5d.

```mermaid
graph LR
    Stripe["Stripe"] -->|"POST /payments/webhooks/stripe<br/>(raw body + Stripe-Signature)"| Ctrl["StripeWebhookController"]

    Ctrl -->|"verify signature<br/>(P9: 400 on invalid/too-old)"| Verify{"valid?"}
    Verify -->|"no"| Reject["400 — no mutation"]
    Verify -->|"yes"| Dedup{"event id<br/>already seen? (P8)"}
    Dedup -->|"yes"| Ack["2xx ACK (no reprocess)"]
    Dedup -->|"no"| Persist["Append sanitized<br/>payment_events row"]
    Persist --> Enqueue["Enqueue on webhook queue<br/>(BullMQ)"]
    Enqueue --> Ack
    Enqueue -.->|"async worker"| Lifecycle["Advance payment /<br/>dispute lifecycle"]
    Lifecycle -.->|"emits"| Events["Payment domain events (§5d)"]
```

The payload is sanitized before persistence (`payment-payload.sanitizer.ts`): only ids, amounts, currency, status, and timestamps are stored — never card data, secrets, or PII.

---

## 5d. Payment Domain Events

> The payments module communicates state changes to other modules through typed domain events (EventEmitter2, defined in `services/api/src/payments/events/payment-events.ts`) rather than writing their tables. Consumers react within their own bounded context.

```mermaid
graph LR
    Payments["Payments Module<br/>(emitter)"]

    Payments -->|"payment.captured"| Notif["Notifications"]
    Payments -->|"payment.released"| Notif
    Payments -->|"payment.refunded"| Notif
    Payments -->|"payment.disputed"| Notif

    Payments -->|"payment.failed"| OfferPub["Offer Publishing<br/>(decides offer next state)"]
    Payments -->|"payment.refunded"| Disputes["Dispute System"]
    Payments -->|"payment.disputed"| Disputes

    Payments -->|"all events"| Analytics["Analytics"]
```

Each event carries a shared base payload (`paymentId`, `offerId`, `hostId`, `cleanerId`, `timestamp`) plus event-specific fields (amounts in cents, currency, failure reason). This keeps the payments module as the sole writer of the `payments` tables while letting other modules advance their own lifecycles.

---

## 5e. Payment Reconciliation (P11)

> Webhooks (§5c) are the primary path for advancing a charge, but delivery can be delayed, dropped, or interrupted mid-flight (e.g. a crash between creating the PaymentIntent and receiving its result). Two periodic sweeps act as a safety net that converges persisted state to Stripe's truth without distributed transactions.

```mermaid
graph LR
    Timer["@Interval sweeps"] --> PayRec["PaymentReconciliationService<br/>(PAYMENTS_RECONCILE_INTERVAL_MS)"]
    Timer --> ConnRec["ConnectReconciliationService<br/>(CONNECT_RECONCILE_INTERVAL_MS)"]

    PayRec -->|"find payments stuck in PROCESSING"| Stuck["Stuck payments (batched)"]
    Stuck -->|"retrieve latest attempt's PaymentIntent"| Stripe["Stripe"]
    Stripe -->|"succeeded"| Held["mark HELD (record fee)"]
    Stripe -->|"canceled / requires_payment_method"| Failed["mark FAILED"]

    ConnRec -->|"retrieve not-yet-payable accounts"| Accts["Stripe connected accounts"]
    Accts -->|"repair flags"| Flags["charges_enabled / payouts_enabled / details_submitted"]
    Flags -->|"newly eligible"| Deferred["flush deferred payouts"]
```

Reconciliation is idempotent: a repair that Stripe already delivered via webhook is a no-op because the persisted state is already terminal for that attempt. Placeholder attempts whose intent id was never persisted (`pending:` prefix) are skipped, and per-payment errors are swallowed so one stuck record never stalls the batch.

---

## 5f. Commission Rate Resolution (two-moment)

> The `commission-system` module (ADR-006) decides *which* commission rate applies to each side of a service. It resolves rates only — the cents arithmetic stays in each consumer's own `CommissionService`, and coupling is one-directional via the `COMMISSION_RATES` token (no circular dependency). The two rates are resolved at different moments because they depend on actors known at different times.

```mermaid
sequenceDiagram
    participant Host
    participant Offers as Offers Module (create)
    participant Rates as COMMISSION_RATES
    participant Tier as SUBSCRIPTION_TIER (stub → Spec 11)
    participant Cleaner as Winning Cleaner
    participant Neg as Negotiation Module (match)

    Host->>Offers: create offer (country, serviceType)
    Offers->>Rates: resolveHostRate({ country, hostId, serviceType })
    Rates->>Tier: getTier(hostId) (bounded; FREE on timeout)
    Rates-->>Offers: { hostFeeRateBps, hostRuleId }
    Note over Offers: own CommissionService → snapshot Host rate on offer

    Cleaner->>Neg: accept / accepted proposal (Cleaner now known)
    Neg->>Rates: resolveCleanerRate({ country, cleanerId, serviceType })
    Rates->>Tier: getTier(cleanerId) (bounded; FREE on timeout)
    Rates-->>Neg: { cleanerRateBps, cleanerRuleId }
    Note over Neg: own CommissionService → snapshot Cleaner rate on winning proposal/offer
```

Resolution selects the most-specific active rule (specificity → priority → `effective_from` → lowest UUID) from `commission_rules`; with an empty ruleset it returns the environment defaults (identical to the prior flat model). Rules never overlap (GiST exclusion constraint), are never physically deleted (audit `ON DELETE RESTRICT`), and rate changes propagate across API instances via Redis pub/sub invalidation. Any failure degrades to the env-default rate and never blocks creation or match.

### Commission Rules Schema

```mermaid
erDiagram
    commission_rules {
        uuid id PK
        char country "ISO alpha-2 or NULL=ANY"
        varchar subscriber_tier "FREE|PRO or NULL=ANY"
        varchar service_type "or NULL=ANY"
        varchar applies_to "HOST|CLEANER"
        integer rate_bps
        integer priority
        timestamptz effective_from
        timestamptz effective_to "NULL=open-ended"
        boolean is_active
        uuid created_by FK
        uuid updated_by FK
    }
    commission_rule_audit {
        uuid id PK
        uuid rule_id FK "ON DELETE RESTRICT"
        varchar action "CREATE|UPDATE|ACTIVATE|DEACTIVATE"
        uuid actor_id FK
        jsonb old_values
        jsonb new_values
        text reason
        timestamptz created_at
    }
    commission_rules ||--o{ commission_rule_audit : "audited by"
```

---

## 5g. Configuration Surfaces & Public/Secret Boundary

> The `secrets-inventory` tooling (`tools/config-inventory/`, ADR-010) derives a single catalog of every external configuration input from the code/config sources, then reconciles the committed `.env.example` against it. The catalog is the derived source of truth for a variable's existence, classification, and requiredness; `.env.example` is a generated PRESENTATION projection. Every variable is assigned to exactly one of four surfaces, and the public/secret boundary is hard: only `EXPO_PUBLIC_*` values (explicitly classified `PUBLIC`) ever reach the mobile client — no `SECRET` does.

```mermaid
graph TB
    subgraph Sources["Config sources — authoritative for existence / classification / requiredness"]
        APP["APPLICATION<br/>*.constants.ts + validateXxxConfig()<br/>pydantic BaseSettings<br/>app.config.ts / EXPO_PUBLIC_*"]
        BLD["BUILD<br/>eas.json profiles / build tokens"]
        DEP["DEPLOY<br/>deploy scripts / VPS env / Traefik"]
        INF["INFRA<br/>docker-compose*.yml (${VAR})"]
        CI["CI<br/>.github/workflows env / codemagic env"]
        RT["RUNTIME<br/>dynamic process.env / os.environ"]
    end

    subgraph Tool["tools/config-inventory (ADR-010)"]
        Model["Canonical inventory model<br/>ConfigVariable[] — derived source of truth<br/>(each var carries DiscoveryProvenance)"]
        Recon["reconcile + classify + exposure scan"]
    end

    subgraph Surfaces["Runtime surfaces"]
        APISurf["API (NestJS)<br/>server .env / VPS env / Vault"]
        AISurf["AI (FastAPI)<br/>own .env — NO storage creds (Option A)"]
        MobileSurf["MOBILE (Expo)<br/>EXPO_PUBLIC_* only — never a SECRET"]
        InfraSurf["INFRA (compose)<br/>service bootstrap env"]
    end

    APP --> Model
    BLD --> Model
    DEP --> Model
    INF --> Model
    CI --> Model
    RT --> Model

    Model --> Recon
    Recon --> EnvEx[".env.example<br/>(PRESENTATION/SHAPE — placeholders only)"]
    Recon --> Doc["docs/CONFIGURATION-INVENTORY.md<br/>+ machine JSON + findings"]

    Model --> APISurf
    Model --> AISurf
    Model --> MobileSurf
    Model --> InfraSurf

    Recon -->|"SECRET on MOBILE / mis-prefixed EXPO_PUBLIC_"| Leak["BLOCKING: SECRET_ON_CLIENT"]
    Recon -->|"secret pattern in tracked artifact"| Exposure["BLOCKING: SECRET_EXPOSURE<br/>(reported, NOT compliant, untouched)"]
```

Two orthogonal axes classify each variable: `requiredScope` (`runtime | build | deploy | infra` — *what lifecycle scope* needs it) and `envApplicability` (`local | staging | production` — *which environments* it applies to). No environment token ever appears in `requiredScope` and no scope token in `envApplicability`. Compliance is `true` only when there are zero blocking findings; no credential is ever rotated, moved, or echoed — findings name the file, line, and matched pattern, never the secret value.

---

## 6. Auth & Security Flow

```mermaid
sequenceDiagram
    participant U as User
    participant App as Mobile App
    participant KC as Keycloak
    participant API as NestJS API
    participant AI as AI Service
    participant Store as MinIO

    Note over U,Store: Registration & KYC (Cleaner)
    U->>App: Sign up (email/Google/Apple)
    App->>KC: Create account
    KC-->>App: JWT tokens

    U->>App: Start KYC
    App->>App: Capture document photo
    App->>AI: Send document image
    AI->>AI: PaddleOCR extracts data
    AI-->>App: Document data (name, ID number)

    App->>App: Capture selfie (liveness check)
    App->>AI: Send selfie + document face
    AI->>AI: DeepFace comparison
    AI-->>App: Match score (>threshold = verified)

    App->>App: Register biometric (fingerprint/face)
    App->>API: Mark user as KYC verified

    Note over U,Store: Video Verification (On Service Arrival)
    U->>App: Arrive at property (geofence)
    App->>App: Activate camera (LiveKit)
    U->>App: "Hi, I'm [name] for the cleaning service"
    App->>Store: Upload video (temporary, 24-48h)
    App->>AI: Extract face from video frame
    AI->>AI: Compare with registered selfie
    AI-->>App: Identity confirmed / denied

    Note over U,Store: Login (Returning User)
    U->>App: Open app
    App->>App: Biometric prompt (fingerprint/face)
    App->>KC: Refresh token
    KC-->>App: New JWT
```

---

## 7. Chat Message Lifecycle (Realtime Chat)

> Post-match Host↔Cleaner messaging (Spec 13, ADR-009). **PostgreSQL is the source of truth; Centrifugo is transport only.** A send persists first, then publishes best-effort — a publish failure never loses the message. There is no immediate-delivery guarantee: recipients recover missed messages via the `after` reconciliation cursor on reconnect. Auth issues Centrifugo tokens; chat owns the participation rule.

```mermaid
sequenceDiagram
    participant S as Sender App
    participant R as Recipient App
    participant Auth as Auth (token endpoint)
    participant API as Chat Module (API)
    participant DB as PostgreSQL
    participant C as Centrifugo

    Note over S,C: Subscribe (both participants)
    S->>Auth: GET /auth/centrifugo/token?channel=chat:conversation:{id}
    Auth->>API: ChatParticipationService.isParticipant(subject, id)
    API-->>Auth: participant? (by JWT subject, not channel string)
    Auth-->>S: subscription token (only if participant)
    S->>C: subscribe chat:conversation:{id}

    Note over S,DB: Send = one serialized transaction (persist-then-publish)
    S->>API: POST /chat/conversations/:id/messages (Idempotency-Key + clientMessageId)
    API->>DB: BEGIN · SELECT ... FOR UPDATE conversation
    API->>DB: verify OPEN · dedup(client_message_id) · next sequence_number · insert · bump last_message_at · COMMIT
    API-->>S: 201 (persisted; deduplicated when a retry)
    API-->>C: publish {type: chat_message} (best-effort)
    C-->>R: live message
    Note over API,C: publish failure → logged (never the body), request still succeeds

    Note over R,DB: Reconnect reconciliation (no immediate-delivery guarantee)
    R->>C: reconnect
    R->>API: GET /chat/conversations/:id/messages?after=<lastSeq>
    API->>DB: keyset read (sequence_number > lastSeq)
    API-->>R: missed messages (client dedups by id + clientMessageId, orders by sequenceNumber)
```

---

*Last updated: September 5, 2026*
*Update this document on EVERY structural change.*
