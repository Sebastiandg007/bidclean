# Requirements Document

## Introduction

BidClean Hosts need to register and manage the properties where they need cleaning services. A property is the core entity that connects a Host to the physical space where a service will be performed. Each property has a detailed profile (similar to Airbnb listings) with photos, address, type classification, dimensions, room counts, and special requirements. Properties serve as the anchor for offer publishing — a Host cannot publish an offer without first having at least one registered property with at least one photo. The property module handles CRUD operations, photo management (MinIO), geocoding (Mapbox), and provides the data that Cleaners see when evaluating an offer.

## Glossary

| Term | Definition |
|------|-----------|
| Property | A physical space registered by a Host where cleaning services are performed |
| Property Type | Classification of the space: apartment, house, office, airbnb, commercial_space, other |
| Amenities | Special characteristics or requirements of the property (pets, eco products, specific tools needed) |
| Checklist | A customizable list of tasks the Host expects the Cleaner to complete |
| Property Photo | Images of the property uploaded by the Host to help Cleaners understand the space |
| Geocoding | Converting a text address into geographic coordinates (lat/lng) via Mapbox |
| Reverse Geocoding | Converting coordinates into a human-readable address |
| Offer-Ready | A property that meets all requirements to be used in an offer (has required fields + at least 1 photo) |
| Location Source | How the geographic coordinates were obtained: `GEOCODED` (Mapbox) or `MANUAL` (user-placed map pin) |

## Requirements

### REQ-1: Property Registration
- The system shall allow Hosts to register new properties with the following required fields:
  - Name/label (e.g., "My apartment", "Office downtown") — max 100 chars
  - Property type (apartment, house, office, airbnb, commercial_space, other)
  - Address (street, city, state/province, postal code, country) — structured fields
  - Geographic coordinates (lat/lng) — obtained via geocoding OR manual map pin placement
  - Square meters (approximate area) — positive number
  - Number of bedrooms (0+) and bathrooms (1+)
- Optional fields:
  - Description (free text, max 1000 chars)
  - Floor number
  - Has parking (boolean)
  - Has elevator (boolean)
  - Special requirements / amenities (array of strings from predefined + custom)
  - Custom checklist items (array of task descriptions)
  - Access instructions (private, shown to Cleaner only after match)
- Property registration requires completed Host onboarding (OnboardingGateGuard)
- A Host can register multiple properties (no upper limit enforced in v1)
- Property creation supports Idempotency-Key header to prevent duplicate creation on mobile retry/timeout
- The system shall store the source of the geographic coordinates (`GEOCODED` or `MANUAL`) for traceability

### REQ-2: Property Photos
- A property may be created with zero photos, but must have at least one photo before it can be used in an offer (offer-ready state)
- Each property can have a maximum number of photos (configurable via env: `PROPERTY_MAX_PHOTOS`, default 10)
- Supported formats: JPEG, PNG, WebP
- Maximum file size per photo is configurable (env: `PROPERTY_PHOTO_MAX_SIZE_MB`)
- Photos are resized to a configurable max dimension (env: `PROPERTY_PHOTO_MAX_DIMENSION_PX`) before storage
- Photos are stored encrypted in MinIO (env: `MINIO_PROPERTY_PHOTOS_BUCKET`) with AES-256 server-side encryption
- Photos have a display order (reorder operation available)
- The first photo (order=0) is the cover photo shown in listing cards
- Signed URLs are generated for display with configurable expiry (env: `PROPERTY_PHOTO_URL_EXPIRY_SECONDS`)
- Photo upload supports Idempotency-Key header to prevent duplicate uploads on mobile retry/timeout
- Photo reorder and deletion operations are executed inside a database transaction to maintain contiguous ordering
- Photo metadata (mime_type, file_size_bytes) is stored alongside the storage reference for auditing and validation

### REQ-3: Property Editing
- The system shall allow Hosts to update all property fields after registration
- Updating address triggers geocoding to refresh coordinates (updates location_source to GEOCODED)
- Updating coordinates via map pin move triggers reverse geocoding to refresh the address display (updates location_source to MANUAL)
- Name, type, dimensions, and room counts can be updated at any time
- If a property has an active offer in progress, the editing responsibility is delegated to the offer domain via a contract interface — the property module does not query offers directly

### REQ-4: Property Deletion (Soft Delete)
- The system shall allow Hosts to delete a property they own
- Properties with active offers or in-progress services cannot be deleted (409 Conflict) — determined via contract with offer domain
- Deletion is a soft delete (sets `deleted_at` timestamp) — data preserved for historical records
- All property photos remain in MinIO until a retention cleanup job runs (future)
- Deleted properties do not appear in the Host's property list or in offer creation
- The ON DELETE CASCADE FK constraint only applies to administrative hard deletion/purge, not normal user soft deletion

### REQ-5: Property Listing (Host View)
- The system shall provide a paginated list of the Host's own properties
- Default sort: most recently updated first
- Each list item shows: cover photo (signed URL), name, type, city, bedroom/bathroom count
- Supports text search by name or address
- Supports filter by property type
- Shows a badge/indicator if the property has an active offer
- All repository queries include `WHERE user_id = :authenticatedUserId AND deleted_at IS NULL` (ownership enforced at query level, not only via guard)

### REQ-6: Property Detail View
- The system shall display the full property detail with all fields
- Photo gallery with horizontal scroll and full-screen viewer
- Map showing the property location (pin on Mapbox)
- Checklist items displayed as a list
- Special requirements displayed as tags/chips
- Access instructions shown (private — not visible to Cleaners until service confirmed)
- "Publish Offer" CTA button navigates to offer creation (future spec)
- Shows property readiness indicator (whether it meets offer-ready requirements)

### REQ-7: Geocoding Integration
- Property creation requires a valid geographic location, but does NOT require successful Mapbox geocoding
- The location can originate from: (1) Forward geocoding, or (2) Manual map pin placement
- When a Host enters a text address, the system queries Mapbox Geocoding API to obtain coordinates
- When a Host places a pin on the map, the system queries Mapbox Reverse Geocoding to obtain a formatted address
- Geocoding results are stored alongside the user-provided address (both are kept)
- Geocoding is done server-side to protect the Mapbox API token
- The geocoded coordinates are stored as PostGIS geography point for future spatial queries
- Geocoding failures are non-blocking — the user can always fall back to manual map pin placement
- Geocoding query input is validated: max 300 characters, country filtering applied
- Geocoding requests include lat/lng validation: latitude ∈ [-90, 90], longitude ∈ [-180, 180]
- The `location_source` field records how coordinates were obtained (GEOCODED / MANUAL)

### REQ-8: Property Data for Cleaners (Public View)
- When a Cleaner views an offer, they see the property detail with three levels of access:
  - **Before match (public):** name, type, photos (signed URLs), city, country, square meters, bedrooms, bathrooms, description, special requirements, checklist, has_parking, has_elevator
  - **After match (matched):** all public fields PLUS exact address (street, state, postal code), coordinates, access instructions
  - **Owner view:** all fields including internal metadata
- The public endpoint uses a dedicated SELECT query — it structurally cannot return private fields
- `formatted_address` is ALWAYS private — never exposed to Cleaners (it may contain full street details)

### REQ-9: Address Privacy
- The exact street address is NEVER shown to Cleaners in the offer/radar view
- Only city and country are displayed during the browsing phase (state is also private)
- `formatted_address` is treated as private data — never included in public projections
- Full address (street, state, postal code) and access instructions are revealed only after the service is confirmed (Cleaner accepted, payment charged)
- This protects Host privacy and prevents unauthorized visits

### REQ-10: Property Validation
- Square meters must be > 0 and <= 10000 (configurable via env: `PROPERTY_MAX_SQM`)
- Bedrooms must be >= 0 and <= 50 (configurable via env: `PROPERTY_MAX_BEDROOMS`)
- Bathrooms must be >= 1 and <= 20 (configurable via env: `PROPERTY_MAX_BATHROOMS`)
- Checklist items limited to max 30 (configurable via env: `PROPERTY_MAX_CHECKLIST_ITEMS`)
- Each checklist item max 200 chars
- Special requirements limited to max 20 items (configurable via env: `PROPERTY_MAX_REQUIREMENTS`)
- Address country must be one of the supported countries (CO, US, CA, GB, DE, FR, IT, ES, PT, NL)
- Latitude must be between -90 and 90 (inclusive)
- Longitude must be between -180 and 180 (inclusive)
- Geocoding query text must not exceed 300 characters

## Non-Functional Requirements

- Property list loads within acceptable time on standard mobile connection (paginated, 20 items/page)
- Photo upload completes within configurable timeout (env: `PROPERTY_UPLOAD_TIMEOUT_MS`)
- All UI text uses i18n keys (no hardcoded strings)
- Property endpoints are rate-limited (configurable via env: `PROPERTY_RATE_LIMIT_PER_MINUTE`)
- All property-related photos use server-side AES-256 encryption in MinIO
- Geocoding requests are rate-limited on the server per user (env: `PROPERTY_GEOCODING_RATE_LIMIT`)
- Property creation and photo upload support Idempotency-Key headers for mobile resilience
- Property API responses include pagination metadata (total, page, limit, totalPages)
- Ownership is enforced at BOTH guard level (PropertyOwnerGuard) AND repository/query level (defense-in-depth)
- Photo ordering operations are transactional with row-level locking to prevent concurrent corruption

## Out of Scope

- Offer creation/publishing → `offer-publishing` spec
- Payment method management → `stripe-escrow` spec
- Cleaner service tracking at property → `service-tracking` spec
- Matched property view endpoint (address reveal) → `offer-negotiation` spec
- Geocoding cache (Redis) → future optimization
- Property analytics/statistics → future spec
- Bulk property import → future spec
- Property templates → future spec
- Cleaning frequency scheduling (recurring) → future spec
