# Implementation Plan

## Overview

Implementation tasks for the Property Management feature. Covers the NestJS backend module (CRUD with ownership guard + query-level enforcement, photo management via MinIO with transactional ordering, geocoding via Mapbox with input validation, PostGIS spatial storage with location_source tracking, address privacy enforcement via dedicated SELECT, idempotency for creation/upload), database migrations (properties with PostGIS geography + location_source, property_photos with metadata columns), and the React Native/Expo mobile screens (property list, detail, create/edit with multi-step form, map integration with manual pin fallback, photo gallery). Properties are the foundation for offer publishing — Hosts must have at least one registered property with photos before creating an offer.

## Tasks

- [x] 1. Create properties module structure in NestJS (module, controller, service, repository, types, dto/, entities/, photo/, geocoding/, guards/, contracts/, __tests__/, README)
- [x] 2. Create database migration for properties table (UUID PK, user_id FK CASCADE, PostGIS geography point, location_source VARCHAR(20) NOT NULL with CHECK constraint, structured address, dimensions, amenities arrays, soft delete, CHECK constraints for type/country/sqm/bedrooms/bathrooms, GiST index on location, partial indexes, CREATE EXTENSION IF NOT EXISTS postgis)
- [x] 3. Create database migration for property_photos table (UUID PK, property_id FK CASCADE, storage_key UNIQUE, mime_type VARCHAR(50) NOT NULL, file_size_bytes INTEGER NOT NULL, display_order, composite index)
- [x] 4. Add property environment variables to .env.example (MINIO_PROPERTY_PHOTOS_BUCKET, PROPERTY_PHOTO_MAX_SIZE_MB, PROPERTY_PHOTO_MAX_DIMENSION_PX, PROPERTY_PHOTO_URL_EXPIRY_SECONDS, PROPERTY_MAX_PHOTOS, PROPERTY_UPLOAD_TIMEOUT_MS, PROPERTY_RATE_LIMIT_PER_MINUTE, PROPERTY_MAX_SQM, PROPERTY_MAX_BEDROOMS, PROPERTY_MAX_BATHROOMS, PROPERTY_MAX_CHECKLIST_ITEMS, PROPERTY_MAX_REQUIREMENTS, MAPBOX_ACCESS_TOKEN, PROPERTY_GEOCODING_RATE_LIMIT)
- [x] 5. Implement Property and PropertyPhoto TypeORM entities (Property: all columns + location_source + constraints; PropertyPhoto: with mime_type and file_size_bytes columns; JSDoc documentation on every column)
- [x] 6. Implement PropertyOwnerGuard (CanActivate guard: extracts propertyId from route params, queries property WHERE id AND user_id AND deleted_at IS NULL, throws ForbiddenException if not owner or not found)
- [x] 7. Implement offer-editability contract interface (OfferEditabilityCheck with default implementation returning editable=true until offer-publishing spec implements it)
- [x] 8. Implement property photo service (MinIO upload with AES-256 encryption, sharp resize, signed URL generation, deletion, max count validation, display_order management with TRANSACTIONAL renumbering via SELECT FOR UPDATE, stores mime_type and file_size_bytes on upload)
- [x] 9. Implement geocoding service (Mapbox forward geocoding: address text → lat/lng with max 300 char validation and country filtering; Mapbox reverse geocoding: lat/lng → formatted address with coordinate validation lat∈[-90,90] lng∈[-180,180]; per-user rate limiting; error handling with non-blocking failures; configurable access token from env)
- [x] 10. Implement properties repository (all queries enforce WHERE user_id = :userId AND deleted_at IS NULL — ownership at query level; dedicated findPublicProperty method with explicit column list that NEVER returns street/state/postal/formatted_address/location/access_instructions; pagination helper with total count)
- [x] 11. Implement POST /properties endpoint (create property with validation, Idempotency-Key header support, geocoded coordinates stored as PostGIS point via ST_MakePoint, location_source set based on how coordinates were provided, Host role + OnboardingGateGuard, returns created property with ID)
- [x] 12. Implement GET /properties endpoint (paginated list of own properties via repository — ownership in query, supports search by name/address ILIKE, filter by type, default sort by updated_at DESC, returns cover photo signed URL for each property)
- [x] 13. Implement GET /properties/:id endpoint (full property detail for owner via repository — ownership in query, all fields including private, includes all photo signed URLs ordered by display_order, includes offer-readiness status)
- [x] 14. Implement PATCH /properties/:id endpoint (partial update of any field, PropertyOwnerGuard + query-level ownership, address change triggers re-geocoding and updates location_source, coordinate change updates location_source to MANUAL, validates constraints, consults OfferEditabilityCheck contract before applying)
- [x] 15. Implement DELETE /properties/:id endpoint (soft delete — sets deleted_at, PropertyOwnerGuard, consults offer domain contract to validate no active offers, returns 204)
- [x] 16. Implement POST /properties/:id/photos endpoint (upload photo with Idempotency-Key, PropertyOwnerGuard, validates max count from env, resize via sharp, store in MinIO with encryption, record mime_type + file_size_bytes, assign next display_order)
- [x] 17. Implement DELETE /properties/:id/photos/:photoId endpoint (remove photo from MinIO + DB within transaction with SELECT FOR UPDATE, PropertyOwnerGuard, renumber remaining photos for contiguous ordering)
- [x] 18. Implement PATCH /properties/:id/photos/order endpoint (reorder photos within transaction with SELECT FOR UPDATE, PropertyOwnerGuard, accepts array of photoId in desired order, updates display_order values, validates all IDs belong to property)
- [ ] 19. Implement POST /properties/geocode endpoint (forward geocoding proxy to Mapbox, Host role guard, validates address.length <= 300 chars, validates country is supported, rate limited per user, returns lat/lng + formattedAddress + confidence)
- [ ] 20. Implement POST /properties/reverse-geocode endpoint (reverse geocoding proxy to Mapbox, Host role guard, validates lat ∈ [-90,90] and lng ∈ [-180,180], rate limited per user, returns structured address components)
- [ ] 21. Implement GET /properties/:id/public endpoint (public view for authenticated Cleaners — uses dedicated repository SELECT that NEVER returns address_street, address_state, address_postal_code, formatted_address, location, location_source, access_instructions; returns only city + country + photos + dimensions + requirements + checklist)
- [ ] 22. Implement property-readiness service method (isOfferReady: checks deleted_at IS NULL + required fields populated + photoCount >= 1 — calculated, not stored)
- [ ] 23. Create mobile properties screens folder structure with README (screens, components, hooks, types, constants, tests)
- [ ] 24. Implement useProperties Zustand store (fetchList with pagination, fetchDetail, createProperty with idempotency key, updateProperty, deleteProperty, uploadPhoto with idempotency key, deletePhoto, reorderPhotos, geocode, reverseGeocode)
- [ ] 25. Implement PropertyListScreen (paginated FlatList with PropertyCard items, pull-to-refresh, search input, type filter chips, empty state with "Add your first property" CTA, FAB for create)
- [ ] 26. Implement PropertyCard component (cover photo with signed URL, property name, type badge, city + country, bedroom/bathroom icons with counts, offer-ready indicator)
- [ ] 27. Implement CreatePropertyScreen (multi-step form: Step 1 basic info + type → Step 2 address + map → Step 3 photos + details, step indicator, validation per step, geocoding with manual pin fallback on failure, save on final step with Idempotency-Key)
- [ ] 28. Implement PropertyTypeSelector component (visual cards with icon and label for each type, single selection, accent border on selected)
- [ ] 29. Implement AddressInput component (structured fields: street, city, state, postal code, country selector, "Locate on Map" button that triggers geocoding, fallback message on geocoding failure)
- [ ] 30. Implement PropertyMap component (Mapbox MapView with draggable pin, tap-to-place pin, shows current property location, triggers reverse geocoding on pin move, works as fallback when geocoding fails)
- [ ] 31. Implement PhotoUploader component (photo grid with upload button, reorder via move up/down, delete with confirmation, max count indicator, uses expo-image-picker, shows mime_type/size info)
- [ ] 32. Implement ChecklistEditor component (add/remove text items, max count validation from constants, reorder via drag or buttons, character limit per item)
- [ ] 33. Implement RequirementsChips component (predefined chips from constants + custom text input, multi-select, max count from constants, visual distinction between predefined and custom)
- [ ] 34. Implement PropertyDetailScreen (photo gallery horizontal scroll + full-screen modal, map section with pin, info cards for dimensions/rooms, checklist section, requirements chips, access instructions card, "Edit" and "Publish Offer" buttons, offer-readiness indicator)
- [ ] 35. Implement EditPropertyScreen (pre-populated form using property detail data, same multi-step structure as Create, save via PATCH endpoint, location_source updates on address/pin change)
- [ ] 36. Implement PropertyPhotoGallery component (horizontal ScrollView of photos, tap for full-screen ImageViewer modal with swipe navigation, photo counter indicator)
- [ ] 37. Create i18n translation files for properties module (en/properties.json, es/properties.json — all screen labels, form fields, error messages, type labels, requirement labels, validation messages, empty states, geocoding fallback messages)

## Task Dependency Graph

```json
{
  "waves": [
    [1, 2, 3, 4, 23],
    [5, 6, 7, 37],
    [8, 9, 10, 24],
    [11, 12, 13, 14, 15, 19, 20, 21, 22, 25, 26, 28, 29],
    [16, 17, 18, 27, 30, 31, 32, 33],
    [34, 35, 36]
  ]
}
```

## Notes

- The properties table uses PostGIS `GEOGRAPHY(Point, 4326)` for the location column. This requires the PostGIS extension (`CREATE EXTENSION IF NOT EXISTS postgis`). The migration handles this. Requires superuser privileges on the database.
- Property photos use the same MinIO encryption pattern as profile photos (AES-256 server-side) but a different bucket (env: `MINIO_PROPERTY_PHOTOS_BUCKET`).
- The `PropertyOwnerGuard` extracts `propertyId` from route params (`:id`), queries the properties table, and compares `user_id` with the authenticated user's ID. It is a SECONDARY defense — the primary enforcement is at the repository/query level where ALL queries include `WHERE user_id = :userId AND deleted_at IS NULL`.
- Geocoding is done server-side to protect the Mapbox access token. The mobile app never calls Mapbox directly for geocoding — it goes through our API proxy endpoints.
- Geocoding input validation: forward geocoding validates address string max 300 chars and country in supported list; reverse geocoding validates lat ∈ [-90,90] and lng ∈ [-180,180].
- The `location_source` column tracks coordinate origin: `GEOCODED` (from Mapbox forward) or `MANUAL` (from user map pin). This aids debugging and data quality assessment.
- Property creation requires coordinates (`location NOT NULL`) but does NOT require successful Mapbox geocoding. The location can come from geocoding OR manual map pin placement. Both are valid.
- Soft delete uses `deleted_at TIMESTAMP WITH TIME ZONE` (NULL = active, non-NULL = deleted). All queries filter `WHERE deleted_at IS NULL` by default. The ON DELETE CASCADE FK only applies to administrative hard deletion/purge.
- The public endpoint (`GET /properties/:id/public`) uses a dedicated repository method with explicit column selection — it structurally cannot return private fields. `formatted_address` is ALWAYS private (may contain full street info).
- Photo display_order is always maintained as contiguous integers starting from 0. Reorder and delete operations execute within a database transaction with `SELECT FOR UPDATE` to prevent concurrent corruption.
- The cover photo is always the one with `display_order = 0`. The property list endpoint fetches only this photo for card display.
- Property photos store `mime_type` and `file_size_bytes` alongside the storage reference for auditing, validation, and avoiding MinIO metadata lookups.
- Idempotency-Key is supported on POST /properties and POST /properties/:id/photos. Duplicate requests return existing resources (200) instead of creating duplicates. This prevents data corruption from mobile timeout/retry.
- Mapbox Geocoding API v5 is used: forward and reverse endpoints with access_token from env.
- The property module defines two contracts for the offer domain: `PropertyReadinessCheck` (is this property usable for offers?) and `OfferEditabilityCheck` (can this property be edited right now?). Both have default implementations until offer-publishing is built.
- Offer-readiness is a CALCULATED state (not a stored column): checks deleted_at IS NULL + required fields present + at least 1 photo.
- Special requirements and checklist items are stored as PostgreSQL arrays (`VARCHAR[]`). Backend validates predefined values against a whitelist and custom values by length/count.
- The Host navigator already has a "Properties" tab placeholder — this spec fills it with real content.
- Country validation uses ISO 3166-1 alpha-2 codes matching the supported markets: CO, US, CA, GB, DE, FR, IT, ES, PT, NL.
- Three levels of property access exist: owner (all), public (city+country only, no formatted_address), matched (address+coords+instructions — implemented by offer-negotiation spec, not here).
- Geocoding cache (Redis) is documented as a future optimization — not implemented in v1.
