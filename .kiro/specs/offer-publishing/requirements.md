# Requirements Document

## Introduction

The offer-publishing system enables Hosts to create, publish, and manage cleaning service offers associated with their registered properties. Once published, offers are progressively delivered to nearby Cleaners through a radius expansion mechanism — first to Favorites, then PRO subscribers, then FREE-tier Cleaners. This module handles the full offer lifecycle from creation through expiration or match, commission/fee calculation for price transparency, and the BullMQ-driven progressive radius expansion scheduler. It does NOT handle counter-offers, payment processing, real-time radar display, push notification infrastructure, or chat.

## Glossary

| Term | Definition |
|------|-----------|
| Offer | A cleaning service request published by a Host, associated with a specific property, containing service type, price, date/time, and duration |
| Host | A registered user with the Host role who owns properties and publishes offers |
| Cleaner | A registered user with the Cleaner role who receives and responds to offers |
| Offer_Publisher | The NestJS backend module responsible for creating, validating, and managing offer lifecycle |
| Radius_Expander | The BullMQ job processor responsible for progressively expanding the geographic search radius over time |
| Delivery_Scheduler | The component responsible for staggering offer delivery to Favorites, PRO, and FREE tier Cleaners |
| Offer-Ready Property | A property that meets all requirements to be used in an offer (not deleted, required fields populated, at least 1 photo) |
| Favorites | Cleaners marked as preferred by a Host, who receive offers before other tiers |
| PRO Cleaner | A Cleaner with an active PRO subscription who receives offers before FREE-tier Cleaners |
| FREE Cleaner | A Cleaner without a PRO subscription, receiving offers after Favorites and PRO Cleaners |
| Service_Fee | The 10% commission charged to the Host on top of the offered price |
| Cleaner_Commission | The 3% deduction from the offered price taken from the Cleaner's payout |
| Radius_Step | A single geographic expansion increment applied by the Radius_Expander at a scheduled interval |
| Centrifugo | The WebSocket server used to deliver real-time offer notifications to connected Cleaners |
| Mobile_App | The React Native mobile application used by Hosts and Cleaners |

## Requirements

### Requirement 1: Offer Creation

**User Story:** As a Host, I want to create a cleaning service offer for one of my properties, so that nearby Cleaners can see my request and respond.

#### Acceptance Criteria

1. WHEN a Host submits a new offer, THE Offer_Publisher SHALL validate that the selected property belongs to the authenticated Host
2. WHEN a Host submits a new offer, THE Offer_Publisher SHALL verify the selected property is offer-ready by calling the PropertyReadinessCheck contract
3. IF the selected property is not offer-ready, THEN THE Offer_Publisher SHALL reject the offer creation and return the specific readiness failure reasons
4. WHEN a Host submits a new offer, THE Offer_Publisher SHALL require: property ID, service type, offered price, scheduled date, scheduled time, estimated duration, and optional description
5. WHEN a Host submits a new offer, THE Offer_Publisher SHALL validate that the offered price is a positive value expressed in the property's country currency
6. WHEN a Host submits a new offer, THE Offer_Publisher SHALL validate that the scheduled date and time are in the future (minimum configurable lead time from current time)
7. WHEN a Host submits a new offer, THE Offer_Publisher SHALL validate that the estimated duration is within the configured minimum and maximum bounds
8. WHEN a Host submits a new offer with a valid Idempotency-Key header, THE Offer_Publisher SHALL return the existing offer if one was already created with the same key
9. WHEN a valid offer is created, THE Offer_Publisher SHALL persist the offer in DRAFT state

### Requirement 2: Duplicate Active Offer Prevention

**User Story:** As a Host, I want the system to prevent me from creating conflicting offers for the same property, so that I do not accidentally double-book a cleaning service.

#### Acceptance Criteria

1. WHEN a Host attempts to create an offer for a property, THE Offer_Publisher SHALL check if an active offer (DRAFT, PUBLISHED, or ACTIVE state) already exists for that property
2. IF an active offer already exists for the property, THEN THE Offer_Publisher SHALL reject the new offer creation with a conflict error indicating the existing offer ID
3. WHEN an existing offer reaches COMPLETED, CANCELLED, or EXPIRED state, THE Offer_Publisher SHALL allow new offers to be created for that property

### Requirement 3: Offer Lifecycle States

**User Story:** As a Host, I want my offers to follow a clear lifecycle, so that I can understand the current status of each offer at any time.

#### Acceptance Criteria

1. THE Offer_Publisher SHALL support the following offer states: DRAFT, PUBLISHED, ACTIVE, MATCHED, COMPLETED, CANCELLED, EXPIRED
2. WHEN an offer is created, THE Offer_Publisher SHALL set its initial state to DRAFT
3. WHEN a Host explicitly publishes a DRAFT offer, THE Offer_Publisher SHALL transition the offer to PUBLISHED state
4. WHEN an offer transitions to PUBLISHED state, THE Offer_Publisher SHALL initiate the delivery scheduling process
5. WHEN at least one Cleaner receives the offer notification, THE Offer_Publisher SHALL transition the offer to ACTIVE state
6. WHEN a Cleaner accepts the offer or the Host selects a counter-offer, THE Offer_Publisher SHALL transition the offer to MATCHED state
7. WHEN the Host cancels a DRAFT or PUBLISHED offer, THE Offer_Publisher SHALL transition the offer to CANCELLED state
8. WHEN the Host cancels an ACTIVE offer, THE Offer_Publisher SHALL transition the offer to CANCELLED state and notify all Cleaners who received it
9. IF the radius expansion reaches maximum distance and no Cleaner has accepted or counter-offered, THEN THE Offer_Publisher SHALL transition the offer to EXPIRED state
10. THE Offer_Publisher SHALL reject any state transition that does not follow the allowed transition paths
11. THE Offer_Publisher SHALL record a timestamp for every state transition

### Requirement 4: Favorites-First Delivery

**User Story:** As a Host, I want the option to offer my cleaning request to my favorite Cleaners first, so that I can prioritize working with professionals I already trust.

#### Acceptance Criteria

1. WHEN a Host publishes an offer, THE Offer_Publisher SHALL prompt whether to offer first to Favorites
2. WHEN the Host chooses favorites-first delivery, THE Delivery_Scheduler SHALL send the offer to Favorite Cleaners within the initial radius immediately upon publication
3. WHILE the favorites-first window is active, THE Delivery_Scheduler SHALL withhold the offer from PRO and FREE tier Cleaners
4. WHEN the favorites-first window expires (configurable duration), THE Delivery_Scheduler SHALL proceed with PRO tier delivery
5. WHEN the Host chooses not to use favorites-first delivery, THE Delivery_Scheduler SHALL proceed directly to tiered delivery starting with PRO Cleaners

### Requirement 5: Tiered Delivery Timing

**User Story:** As a platform operator, I want PRO Cleaners to receive offers before FREE-tier Cleaners, so that the subscription provides tangible value and incentivizes upgrades.

#### Acceptance Criteria

1. WHEN the favorites-first window expires or favorites-first is not selected, THE Delivery_Scheduler SHALL deliver the offer to PRO Cleaners within the current radius
2. WHEN a configurable delay elapses after PRO delivery, THE Delivery_Scheduler SHALL deliver the offer to FREE Cleaners within the current radius
3. THE Delivery_Scheduler SHALL deliver offers via Centrifugo WebSocket channel to connected Cleaners
4. THE Delivery_Scheduler SHALL enqueue a push notification via OneSignal for Cleaners not currently connected to the WebSocket

### Requirement 6: Progressive Radius Expansion

**User Story:** As a Host, I want my offer to reach more Cleaners over time if nobody nearby accepts, so that my chances of getting the service fulfilled increase.

#### Acceptance Criteria

1. WHEN an offer is published, THE Radius_Expander SHALL start with a configurable initial radius centered on the property's PostGIS coordinates
2. WHEN a configurable interval elapses, THE Radius_Expander SHALL expand the search radius by a configurable step size
3. WHEN the radius expands, THE Delivery_Scheduler SHALL deliver the offer to newly-included Cleaners respecting tier order (PRO first, then FREE after configured delay)
4. THE Radius_Expander SHALL continue expanding until the offer is accepted, the configurable maximum radius is reached, or the Host cancels
5. WHEN the maximum radius is reached and no Cleaner has accepted or counter-offered, THE Radius_Expander SHALL wait one final interval before triggering offer expiration
6. THE Radius_Expander SHALL use BullMQ delayed jobs to schedule each expansion step
7. IF the Radius_Expander job fails, THEN THE Radius_Expander SHALL retry with exponential backoff (configurable max retries) before marking the job as failed

### Requirement 7: Offer Expiration

**User Story:** As a Host, I want to be notified when nobody accepts my offer, so that I can modify the price or conditions and try again.

#### Acceptance Criteria

1. IF the maximum radius is reached and the final wait interval passes without acceptance, THEN THE Offer_Publisher SHALL transition the offer to EXPIRED state
2. WHEN an offer expires, THE Offer_Publisher SHALL notify the Host with a suggestion to modify the offered price
3. WHEN an offer expires, THE Offer_Publisher SHALL cancel all pending BullMQ expansion jobs for that offer
4. WHEN an offer is in EXPIRED state, THE Offer_Publisher SHALL allow the Host to create a new offer for the same property

### Requirement 8: Price Transparency for Host

**User Story:** As a Host, I want to see the total cost including platform fees before publishing, so that I know exactly how much I will pay.

#### Acceptance Criteria

1. WHEN a Host creates or views an offer, THE Offer_Publisher SHALL display three price components: the offered price, the service fee (configured Host commission percentage of offered price), and the total to pay (offered price + service fee)
2. THE Offer_Publisher SHALL calculate the service fee using the configured Host commission rate, rounded to 2 decimal places using banker's rounding
3. WHEN a Host reviews an offer before publishing, THE Offer_Publisher SHALL present the total cost breakdown clearly

### Requirement 9: Price Transparency for Cleaner

**User Story:** As a Cleaner, I want to see my net payout after platform commission before deciding on an offer, so that I can make an informed decision.

#### Acceptance Criteria

1. WHEN a Cleaner views an offer, THE Offer_Publisher SHALL display three price components: the offered price, the commission deduction (configured Cleaner commission percentage of offered price), and the net payout (offered price - commission)
2. THE Offer_Publisher SHALL calculate the cleaner commission using the configured Cleaner commission rate, rounded to 2 decimal places using banker's rounding
3. THE Offer_Publisher SHALL include the price breakdown in every offer delivery payload sent to Cleaners

### Requirement 10: Offer Listing and History

**User Story:** As a Host, I want to view my offers organized by status, so that I can track active requests and review past activity.

#### Acceptance Criteria

1. THE Offer_Publisher SHALL provide a paginated list of the Host's own offers
2. WHEN a Host requests their offer list, THE Offer_Publisher SHALL support filtering by state (ACTIVE, COMPLETED, EXPIRED, CANCELLED)
3. WHEN a Host requests their offer list, THE Offer_Publisher SHALL return each offer with: property name, service type, offered price, total cost, scheduled date, current state, and creation timestamp
4. WHEN a Host requests a specific offer detail, THE Offer_Publisher SHALL return the full offer data including state transition history and price breakdown
5. THE Offer_Publisher SHALL sort offers by creation date descending by default

### Requirement 11: Offer Cancellation

**User Story:** As a Host, I want to cancel an offer that I no longer need, so that Cleaners are not presented with outdated requests.

#### Acceptance Criteria

1. WHEN a Host cancels an offer in DRAFT state, THE Offer_Publisher SHALL transition the offer to CANCELLED without side effects
2. WHEN a Host cancels an offer in PUBLISHED state, THE Offer_Publisher SHALL transition the offer to CANCELLED and cancel all pending BullMQ jobs
3. WHEN a Host cancels an offer in ACTIVE state, THE Offer_Publisher SHALL transition the offer to CANCELLED, cancel all pending BullMQ jobs, and publish a cancellation event via Centrifugo for Cleaners who received the offer
4. THE Offer_Publisher SHALL reject cancellation of offers in MATCHED, COMPLETED, or EXPIRED states

### Requirement 12: Mobile Offer Creation Form

**User Story:** As a Host, I want an intuitive mobile form to create offers, so that publishing a cleaning request is quick and easy.

#### Acceptance Criteria

1. THE Mobile_App SHALL present an offer creation form with: property selector (only offer-ready properties), service type picker, price input with currency symbol, date picker, time picker, duration selector, and optional description field
2. WHEN the Host selects a property, THE Mobile_App SHALL display the property name, cover photo, and city for confirmation
3. WHEN the Host enters a price, THE Mobile_App SHALL immediately display the service fee and total cost breakdown below the input
4. THE Mobile_App SHALL validate all required fields before enabling the publish action
5. THE Mobile_App SHALL present a confirmation screen showing the full offer summary before publishing
6. WHEN the confirmation is accepted, THE Mobile_App SHALL present the favorites-first option before final publication

### Requirement 13: Mobile Offer List and Detail

**User Story:** As a Host, I want to view and manage my offers from my phone, so that I can stay informed on the go.

#### Acceptance Criteria

1. THE Mobile_App SHALL display a tab-filtered offer list (Active, Completed, Expired, Cancelled)
2. WHEN a Host taps an offer card, THE Mobile_App SHALL navigate to a detail screen showing: property info, service type, full price breakdown, scheduled date and time, current state, and state transition timeline
3. WHILE an offer is in ACTIVE state, THE Mobile_App SHALL display the current expansion radius and a live timer indicating next expansion
4. WHILE an offer is in DRAFT or PUBLISHED or ACTIVE state, THE Mobile_App SHALL present a cancel button

## Non-Functional Requirements

- Offer creation endpoint must respond within 500ms under normal load
- Radius expansion jobs must execute within 2 seconds of their scheduled time
- Offer delivery via Centrifugo must reach connected Cleaners within 1 second of dispatch
- The system must support 500 concurrent active offers without degradation
- All offer monetary values stored as integers (cents) to avoid floating-point precision errors
- Offer state transitions must be atomic (no partial transitions visible to other readers)
- BullMQ jobs must be idempotent (safe to retry without side effects)

## Out of Scope

- Counter-offers and negotiation → `offer-negotiation` spec
- Payment charge and escrow → `stripe-escrow` spec
- Real-time radar display for Cleaners → `offer-radar` spec
- Push notification delivery infrastructure → `push-notifications` spec
- Chat between Host and Cleaner → `realtime-chat` spec
- Cleaner subscription management (PRO tier) → `subscriptions` spec
- Favorites management (adding/removing favorites) → `favorites` spec
