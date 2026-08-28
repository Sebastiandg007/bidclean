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
        RevenueCat["RevenueCat<br/>(Subscriptions + Ads)"]
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
            Service["Service In Progress"]
            Chat["Chat Screen"]
            PropertyEdit["Property Editor"]
        end

        subgraph Stores["Zustand Stores"]
            AuthStore["useAuthStore"]
            RoleStore["useRoleStore"]
            OffersStore["useOffersStore"]
            RadarStore["useRadarStore"]
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
    Payments --> DB
    Payments --> |"Stripe SDK"| Stripe["Stripe Connect"]
    Chat --> Cache
    Chat --> |"Centrifugo API"| Centrifugo["Centrifugo"]
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

*Last updated: August 27, 2026*
*Update this document on EVERY structural change.*
