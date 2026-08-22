# Design Document

## Overview

The property management system enables Hosts to register, edit, and manage their properties — the physical spaces where cleaning services are performed. The NestJS API handles CRUD operations, photo management (MinIO with AES-256 encryption), and geocoding (Mapbox server-side). The React Native mobile app provides listing, creation/editing forms, map-based address selection, and photo gallery management. Properties use PostGIS for geographic storage, enabling future spatial queries for offer radius expansion. Address privacy is enforced at the API level: Cleaners only see city + country until a service is confirmed. The system tracks how coordinates were obtained (geocoded vs manual pin) via `location_source` for traceability.

### Responsibility Matrix

| Responsibility | Mobile App | NestJS API | MinIO | Mapbox | PostGIS |
|----------------|-----------|------------|-------|--------|---------|
| Property CRUD UI | ✅ | ❌ | ❌ | ❌ | ❌ |
| Property persistence | ❌ | ✅ | ❌ | ❌ | ✅ |
| Photo upload/display | ✅ (capture) | ✅ (store) | ✅ (storage) | ❌ | ❌ |
| Geocoding (address→coords) | ❌ | ✅ (proxy) | ❌ | ✅ | ❌ |
| Reverse geocoding (coords→address) | ❌ | ✅ (proxy) | ❌ | ✅ | ❌ |
| Map display | ✅ (Mapbox SDK) | ❌ | ❌ | ✅ | ❌ |
| Address privacy enforcement | ❌ | ✅ | ❌ | ❌ | ❌ |
| Spatial queries (future) | ❌ | ✅ | ❌ | ❌ | ✅ |
| Offer-readiness check | ✅ (display) | ✅ (calculate) | ❌ | ❌ | ❌ |

## Architecture

```
Mobile App (Expo)
├── Property List Screen (paginated cards, search, filter by type)
├── Property Detail Screen (full view with photo gallery, map, checklist)
├── Create/Edit Property Screen (multi-step form with address + map + photos)
└── Photo Gallery Manager (upload, reorder, delete)
        ↓ API calls
NestJS API (property module)
├── POST   /properties              — create new property (Idempotency-Key)
├── GET    /properties              — list own properties (paginated, filterable)
├── GET    /properties/:id          — get property detail (owner view — full data)
├── PATCH  /properties/:id          — update property fields
├── DELETE /properties/:id          — soft delete property
├── POST   /properties/:id/photos   — upload property photo (Idempotency-Key)
├── DELETE /properties/:id/photos/:photoId — remove property photo (transactional)
├── PATCH  /properties/:id/photos/order   — reorder photos (transactional)
├── POST   /properties/geocode      — forward geocoding (address → coordinates)
├── POST   /properties/reverse-geocode — reverse geocoding (coordinates → address)
├── GET    /properties/:id/public   — get property (Cleaner public view — no private fields)
        ↓ storage
MinIO (encrypted object storage)
├── Bucket: configurable (env: MINIO_PROPERTY_PHOTOS_BUCKET)
│   └── {propertyId}/{photoId}.{ext}
        ↓ geocoding
Mapbox Geocoding API
├── Forward: text address → lat/lng (max 300 chars input)
└── Reverse: lat/lng → formatted address (validated coordinates)
        ↓ spatial storage
PostgreSQL + PostGIS
└── properties.location (GEOGRAPHY(Point, 4326))
```

## Components and Interfaces

### API Endpoints (NestJS)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/properties` | Create new property (Idempotency-Key) | Access token (Host role, onboarding complete) |
| GET | `/properties` | List own properties (paginated) | Access token (Host role) |
| GET | `/properties/:id` | Get property detail (owner — full data) | Access token (Host role, ownership) |
| PATCH | `/properties/:id` | Update property fields | Access token (Host role, ownership) |
| DELETE | `/properties/:id` | Soft delete property | Access token (Host role, ownership) |
| POST | `/properties/:id/photos` | Upload property photo (Idempotency-Key) | Access token (Host role, ownership) |
| DELETE | `/properties/:id/photos/:photoId` | Remove property photo | Access token (Host role, ownership) |
| PATCH | `/properties/:id/photos/order` | Reorder photos | Access token (Host role, ownership) |
| POST | `/properties/geocode` | Forward geocoding | Access token (Host role) |
| POST | `/properties/reverse-geocode` | Reverse geocoding | Access token (Host role) |
| GET | `/properties/:id/public` | Public property view (authenticated Cleaners) | Access token |

### Component Structure (Backend — NestJS)

```
services/api/src/properties/
├── properties.module.ts
├── properties.controller.ts
├── properties.service.ts
├── properties.repository.ts
├── properties.types.ts
├── photo/
│   ├── property-photo.service.ts
│   └── property-photo.types.ts
├── geocoding/
│   ├── geocoding.service.ts
│   └── geocoding.types.ts
├── dto/
│   ├── create-property.dto.ts
│   ├── update-property.dto.ts
│   ├── property-query.dto.ts (pagination + filters)
│   ├── geocode-request.dto.ts
│   ├── reorder-photos.dto.ts
│   └── property-response.dto.ts
├── entities/
│   ├── property.entity.ts
│   └── property-photo.entity.ts
├── guards/
│   └── property-owner.guard.ts
├── contracts/
│   └── offer-editability.interface.ts (contract for offer domain)
├── __tests__/
│   ├── properties.service.spec.ts
│   ├── properties.controller.spec.ts
│   ├── property-photo.service.spec.ts
│   ├── geocoding.service.spec.ts
│   └── property-owner.guard.spec.ts
└── README.md
```

### Component Structure (Mobile)

```
apps/mobile/src/screens/properties/
├── PropertyListScreen.tsx (paginated list with search + type filter)
├── PropertyDetailScreen.tsx (full detail view with gallery, map, checklist)
├── CreatePropertyScreen.tsx (multi-step form: info → address → photos)
├── EditPropertyScreen.tsx (edit form pre-filled with existing data)
├── useProperties.ts (Zustand store + API calls)
├── properties.types.ts
├── properties.constants.ts
├── components/
│   ├── PropertyCard.tsx (list item card with cover photo)
│   ├── PropertyPhotoGallery.tsx (horizontal scroll + full-screen)
│   ├── PropertyMap.tsx (Mapbox map with pin, tap-to-place)
│   ├── AddressInput.tsx (structured address form + geocode button)
│   ├── ChecklistEditor.tsx (add/remove/reorder checklist items)
│   ├── RequirementsChips.tsx (selectable chips + custom input)
│   ├── PropertyTypeSelector.tsx (visual type selection cards)
│   └── PhotoUploader.tsx (photo grid with upload/reorder/delete)
├── __tests__/
│   ├── PropertyListScreen.spec.tsx
│   ├── PropertyDetailScreen.spec.tsx
│   ├── CreatePropertyScreen.spec.tsx
│   └── EditPropertyScreen.spec.tsx
└── README.md
```

## Data Models

### Properties Table

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(30) NOT NULL,
    description TEXT,
    
    -- Address (structured — user-entered or reverse-geocoded)
    address_street VARCHAR(255) NOT NULL,
    address_city VARCHAR(100) NOT NULL,
    address_state VARCHAR(100),
    address_postal_code VARCHAR(20),
    address_country CHAR(2) NOT NULL,
    
    -- Geocoded location (PostGIS)
    location GEOGRAPHY(Point, 4326) NOT NULL,
    formatted_address VARCHAR(500),
    location_source VARCHAR(20) NOT NULL,
    
    -- Dimensions
    square_meters NUMERIC(8,2) NOT NULL,
    bedrooms INTEGER NOT NULL DEFAULT 0,
    bathrooms INTEGER NOT NULL DEFAULT 1,
    floor_number INTEGER,
    
    -- Amenities
    has_parking BOOLEAN NOT NULL DEFAULT false,
    has_elevator BOOLEAN NOT NULL DEFAULT false,
    special_requirements VARCHAR(100)[] DEFAULT '{}',
    
    -- Checklist
    checklist_items VARCHAR(200)[] DEFAULT '{}',
    
    -- Private (revealed only after match)
    access_instructions TEXT,
    
    -- Metadata
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_type CHECK (type IN ('apartment', 'house', 'office', 'airbnb', 'commercial_space', 'other')),
    CONSTRAINT chk_country CHECK (address_country IN ('CO', 'US', 'CA', 'GB', 'DE', 'FR', 'IT', 'ES', 'PT', 'NL')),
    CONSTRAINT chk_sqm CHECK (square_meters > 0),
    CONSTRAINT chk_bedrooms CHECK (bedrooms >= 0),
    CONSTRAINT chk_bathrooms CHECK (bathrooms >= 1),
    CONSTRAINT chk_location_source CHECK (location_source IN ('GEOCODED', 'MANUAL'))
);

-- Indexes
CREATE INDEX idx_properties_user ON properties(user_id);
CREATE INDEX idx_properties_user_active ON properties(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_properties_location ON properties USING GIST(location);
CREATE INDEX idx_properties_type ON properties(type) WHERE deleted_at IS NULL;
```

### Property Photos Table

```sql
CREATE TABLE property_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    storage_key VARCHAR(512) NOT NULL,
    mime_type VARCHAR(50) NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT uq_property_photos_key UNIQUE(storage_key)
);

CREATE INDEX idx_property_photos_property ON property_photos(property_id);
CREATE INDEX idx_property_photos_order ON property_photos(property_id, display_order);
```

### Data Relationships

```
users (from user-authentication)
├── host_profiles (1:1, from user-roles)
└── properties (1:N, owned by this module, ON DELETE CASCADE)
    └── property_photos (1:N, ON DELETE CASCADE)

Note: ON DELETE CASCADE on properties FK only triggers on hard DELETE
(administrative purge). Normal user deletion is soft delete (sets deleted_at).
```

## Three-Level Property Access Model

```
┌─────────────────────────────────────────────────────────┐
│ OWNER VIEW (Host — GET /properties/:id)                 │
├─────────────────────────────────────────────────────────┤
│ All fields: name, type, description, full address,      │
│ formatted_address, location, location_source,           │
│ dimensions, amenities, checklist, access_instructions,  │
│ all photos, metadata (created_at, updated_at)           │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ PUBLIC VIEW (Cleaner before match — GET /:id/public)    │
├─────────────────────────────────────────────────────────┤
│ name, type, description, city, country,                 │
│ square_meters, bedrooms, bathrooms, floor_number,       │
│ has_parking, has_elevator, special_requirements,        │
│ checklist_items, photos (signed URLs)                   │
│                                                         │
│ NEVER: address_street, address_state,                   │
│ address_postal_code, formatted_address, location,       │
│ access_instructions, location_source                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ MATCHED VIEW (Cleaner after service confirmed)          │
│ (Implemented by offer-negotiation spec, not here)       │
├─────────────────────────────────────────────────────────┤
│ All public fields PLUS:                                 │
│ address_street, address_state, address_postal_code,     │
│ location (coordinates for navigation),                  │
│ access_instructions                                     │
│                                                         │
│ STILL NEVER: formatted_address, location_source         │
└─────────────────────────────────────────────────────────┘
```

## Offer-Readiness Contract

The property module defines but does NOT enforce offer-readiness at the API level. Instead, it exposes a method that other modules (offer-publishing) can call:

```typescript
/** Contract: determines if a property can be used in an offer */
interface PropertyReadinessCheck {
  isOfferReady(propertyId: string): Promise<{
    ready: boolean;
    reasons: string[]; // e.g., ["missing_photos", "missing_required_field"]
  }>;
}
```

A property is offer-ready when:
1. `deleted_at IS NULL`
2. All required fields are populated (name, type, address, location, sqm, bathrooms)
3. At least 1 photo exists in property_photos

This is a **calculated state**, not a stored column — always derived from current data.

## Offer-Editability Contract

The property module delegates "can this property be edited?" decisions to the offer domain:

```typescript
/** Contract: offer domain implements this to control property editability */
interface OfferEditabilityCheck {
  canModifyProperty(propertyId: string, fields: string[]): Promise<{
    editable: boolean;
    blockedFields: string[];
    reason?: string;
  }>;
}
```

Until offer-publishing is implemented, this contract returns `{ editable: true, blockedFields: [] }` (default implementation allows all edits).

## Geocoding Service

### Forward Geocoding Flow
```
1. Host enters address text in form
2. Mobile sends POST /properties/geocode { address: "Cra 7 Bogotá", country: "CO" }
3. API validates: address.length <= 300, country is supported
4. API calls Mapbox: GET /geocoding/v5/mapbox.places/{query}.json?country={co}&access_token={token}
5. Returns best match: { lat, lng, formattedAddress, confidence }
6. Mobile places pin on map at returned coordinates
7. Host can adjust pin manually → triggers reverse geocoding
8. On property save: location_source = "GEOCODED"
```

### Reverse Geocoding Flow
```
1. Host taps/drags pin on map to a new position
2. Mobile sends POST /properties/reverse-geocode { lat: 4.624, lng: -74.063 }
3. API validates: lat ∈ [-90, 90], lng ∈ [-180, 180]
4. API calls Mapbox: GET /geocoding/v5/mapbox.places/{lng},{lat}.json?access_token={token}
5. Returns: { formattedAddress, street, city, state, country, postalCode }
6. Mobile updates address fields with returned data
7. On property save: location_source = "MANUAL"
```

### Manual Pin Flow (Geocoding Failure Fallback)
```
1. Host enters address → geocoding fails (Mapbox down / no results)
2. UI shows: "Could not find address. Place pin manually on the map."
3. Host taps map to place pin
4. Reverse geocoding attempted to fill address fields
5. If reverse also fails: Host fills address manually + pin stays where placed
6. On property save: location_source = "MANUAL"
7. Property creation succeeds (location has valid coordinates from pin)
```

### Mapbox Configuration
- API token stored in env: `MAPBOX_ACCESS_TOKEN`
- Rate limiting per user: env `PROPERTY_GEOCODING_RATE_LIMIT` (requests per minute)
- Country bias for results based on request's `country` parameter
- Language for results based on user's language setting
- Geocoding cache: future optimization (Redis) — not implemented in v1

## Idempotency

### POST /properties
- Accepts `Idempotency-Key` header (UUID)
- If a property with the same idempotency key exists for this user, returns the existing property (200) instead of creating a duplicate
- Idempotency key stored in a dedicated column or lookup table
- Key expires after 24 hours (cleanup via scheduled job or TTL)

### POST /properties/:id/photos
- Accepts `Idempotency-Key` header (UUID)
- If a photo with the same idempotency key exists for this property, returns the existing photo (200)
- Prevents duplicate uploads on timeout/retry

## Photo Ordering — Transactional Guarantee

Photo reorder and deletion operations execute within a database transaction:

```
BEGIN TRANSACTION;
  -- Lock photos for this property to prevent concurrent corruption
  SELECT * FROM property_photos WHERE property_id = :id FOR UPDATE;
  
  -- Apply reorder or delete
  -- Renumber remaining photos: 0, 1, 2, ... (contiguous, no gaps)
  
COMMIT;
```

This prevents two simultaneous reorder/delete requests from corrupting the display_order sequence.

## Error Handling

| Error Case | HTTP Status | Response |
|-----------|-------------|----------|
| Property not found | 404 | `property.error.not_found` |
| Not the property owner | 403 | `property.error.not_owner` |
| Active offer exists (delete) | 409 | `property.error.has_active_offer` |
| Photo limit reached | 400 | `property.error.max_photos_reached` |
| Photo not found | 404 | `property.error.photo_not_found` |
| Invalid photo format | 400 | `property.error.invalid_photo_format` |
| Photo too large | 413 | `property.error.photo_too_large` |
| Geocoding failed | 422 | `property.error.geocoding_failed` |
| Invalid country | 400 | `property.error.unsupported_country` |
| Invalid property type | 400 | `property.error.invalid_type` |
| Invalid coordinates | 400 | `property.error.invalid_coordinates` |
| Geocode query too long | 400 | `property.error.geocode_query_too_long` |
| Duplicate (idempotency) | 200 | Returns existing resource |
| Validation errors | 400 | Field-specific validation messages |
| Host onboarding incomplete | 403 | `roles.error.onboarding_incomplete` |

## Testing Strategy

### Unit Tests (NestJS)
- Properties service: CRUD operations, soft delete, ownership at query level, pagination, idempotency
- Property photo service: upload, resize, encryption, transactional ordering, deletion with renumbering, max count, metadata storage
- Geocoding service: forward geocoding, reverse geocoding, error handling, rate limiting, input validation (length, coordinates)
- Property owner guard: ownership check, 403 on non-owner access
- Controller: endpoint routing, DTO validation, guard integration, idempotency-key handling

### Component Tests (Mobile)
- PropertyListScreen: pagination, search, type filter, empty state, card rendering
- PropertyDetailScreen: photo gallery, map display, checklist, requirements chips, offer-ready indicator
- CreatePropertyScreen: multi-step form, validation, address geocoding, manual pin fallback, photo upload
- EditPropertyScreen: pre-populated form, save flow

### Integration Tests
- Full property lifecycle: create (idempotent) → upload photos → edit → delete
- Geocoding round-trip: address → coordinates → reverse → validate location_source tracking
- Address privacy: public endpoint strips private fields (including formatted_address and state)
- Photo management: upload → reorder (transactional) → delete (renumber) → verify contiguity
- Ownership enforcement: verify queries always filter by user_id (defense-in-depth)

## Correctness Properties

### Property 1: Ownership Isolation
A Host can only view, edit, and delete their own properties. Ownership is enforced at TWO levels: (1) `PropertyOwnerGuard` on all mutation endpoints, and (2) all repository queries include `WHERE user_id = :authenticatedUserId AND deleted_at IS NULL`. There is no endpoint to list all properties in the system. Additionally, property creation and photo upload accept Idempotency-Key headers — duplicate requests return existing resources (200) instead of creating duplicates, preventing data corruption from mobile timeout/retry scenarios.

**Validates: Requirements 1, 2, 3, 4, 5**

### Property 2: Address Privacy
The public property endpoint (`GET /properties/:id/public`) NEVER returns `address_street`, `address_state`, `address_postal_code`, `formatted_address`, `access_instructions`, `location_source`, or raw `location` coordinates. Only `city` and `country` are exposed. This is enforced at the query level (dedicated SELECT), not post-fetch filtering. `formatted_address` is ALWAYS treated as private data.

**Validates: Requirements 8, 9**

### Property 3: Soft Delete Consistency
Soft-deleted properties (where `deleted_at IS NOT NULL`) are excluded from ALL queries: listing, offer creation, and public views. The partial index `idx_properties_user_active` ensures only active properties are returned efficiently. The ON DELETE CASCADE FK constraint only applies to administrative hard deletion/purge operations.

**Validates: Requirements 4, 5**

### Property 4: Photo Ordering Integrity
Photo display_order values are always contiguous (0, 1, 2, ...) with no gaps. After a photo deletion or reorder operation, the remaining photos are renumbered to maintain contiguity within a database transaction with row-level locking. The cover photo is always order=0. Concurrent operations on the same property's photos are serialized via SELECT FOR UPDATE.

**Validates: Requirements 2**

### Property 5: Geocoding Resilience
Geocoding failures (Mapbox API down, rate limit exceeded, no results) are non-blocking. The user can always fall back to manual map pin placement. The `location` column is NOT NULL but can be populated via either geocoding OR manual pin. The `location_source` column tracks the origin of coordinates for traceability.

**Validates: Requirements 7**
