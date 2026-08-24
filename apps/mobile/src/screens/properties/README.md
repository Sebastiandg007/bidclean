# Properties Screens

## Purpose

Property management screens for BidClean Hosts. This module provides the UI for registering, viewing, editing, and managing properties — the physical spaces where cleaning services are performed. Properties are the foundation for offer publishing: a Host must have at least one registered property with photos before creating an offer. The module includes multi-step creation forms, Mapbox map integration for address selection, photo management, and checklist/requirements editing.

## Flow

```
Properties Tab (Host navigator)
  → PropertyListScreen (paginated cards, search, type filter, FAB → create)
  → PropertyDetailScreen (full view: gallery, map, checklist, requirements, offer-ready indicator)
  → CreatePropertyScreen (multi-step: info → address + map → photos + details)
  → EditPropertyScreen (pre-populated form, same steps as Create)

Address / Map flow:
  → Type address → Geocode → Pin on map (auto-placed)
  → OR: Geocode fails → Manual pin placement → Reverse geocode for address
  → OR: Drag pin → Reverse geocode updates address fields
```

## Files

| File | Responsibility |
|------|---------------|
| `PropertyListScreen.tsx` | Paginated FlatList of PropertyCard items with search, type filter chips, empty state CTA, and FAB for creating new properties |
| `PropertyDetailScreen.tsx` | Full property detail: photo gallery (horizontal scroll + full-screen), map section with pin, dimensions/rooms cards, checklist, requirements chips, access instructions, Edit/Publish Offer buttons, offer-readiness indicator |
| `CreatePropertyScreen.tsx` | Multi-step form: Step 1 (basic info + type) → Step 2 (address + map with geocoding/manual fallback) → Step 3 (photos + checklist + requirements). Saves with Idempotency-Key |
| `EditPropertyScreen.tsx` | Pre-populated edit form using property detail data. Same multi-step structure as Create. Saves via PATCH endpoint with location_source updates |
| `useProperties.ts` | Zustand store (fully implemented): paginated list, CRUD, photo upload/delete/reorder, forward/reverse geocoding. All mutations use Idempotency-Key headers. Exports `usePropertiesStore` (raw) and `useProperties()` convenience hook |
| `properties.types.ts` | Shared TypeScript types: Property, PropertyListItem, payloads, responses |
| `properties.constants.ts` | Environment-derived config, validation limits, property types, countries, design tokens |

## Components

| File | Responsibility |
|------|---------------|
| `components/PropertyCard.tsx` | List item card: cover photo, name, type badge, city + country, bedroom/bathroom counts, offer-ready indicator |
| `components/PropertyPhotoGallery.tsx` | Horizontal photo scroll with tap-to-fullscreen modal, swipe navigation, photo counter |
| `components/PropertyMap.tsx` | Mapbox MapView with draggable pin, tap-to-place, triggers reverse geocoding on move |
| `components/AddressInput.tsx` | Structured address form (street, city, state, postal code, country), "Locate on Map" geocode button, fallback message |
| `components/ChecklistEditor.tsx` | Add/remove/reorder checklist items with max count and character limit validation |
| `components/RequirementsChips.tsx` | Predefined chips + custom text input, multi-select, max count validation, visual distinction |
| `components/PropertyTypeSelector.tsx` | Visual type selection cards with icons, single selection, accent border on selected |
| `components/PhotoUploader.tsx` | Photo grid with upload button (expo-image-picker), reorder, delete with confirmation, max count indicator |

## Tests

| File | Coverage |
|------|----------|
| `__tests__/PropertyListScreen.spec.tsx` | Pagination, search, type filter, empty state, card navigation, FAB |
| `__tests__/PropertyDetailScreen.spec.tsx` | Photo gallery, map, dimensions, checklist, requirements, offer-readiness, navigation |
| `__tests__/CreatePropertyScreen.spec.tsx` | Multi-step form, validation, geocoding, manual pin fallback, photo upload, idempotency |
| `__tests__/EditPropertyScreen.spec.tsx` | Pre-populated form, validation, re-geocoding, location_source, PATCH save |

## Dependencies

- `@rnmapbox/maps` — Mapbox MapView for property location display and pin placement
- `expo-image-picker` — Photo capture and selection for property photos
- `react-native-reanimated` — Animations for transitions, gallery, step indicators
- `react-native-safe-area-context` — Safe area wrapper
- `expo-router` — Navigation between property screens
- `zustand` — Property state management (one store per domain)
- API service (`src/services/api.service.ts`) — Property CRUD, photo, and geocoding endpoints

## API Endpoints Used

| Method | Path | Description |
|--------|------|-------------|
| POST | `/properties` | Create new property (Idempotency-Key) |
| GET | `/properties` | List own properties (paginated, filterable) |
| GET | `/properties/:id` | Get property detail (owner — full data) |
| PATCH | `/properties/:id` | Update property fields |
| DELETE | `/properties/:id` | Soft delete property |
| POST | `/properties/:id/photos` | Upload property photo (Idempotency-Key) |
| DELETE | `/properties/:id/photos/:photoId` | Remove property photo |
| PATCH | `/properties/:id/photos/order` | Reorder photos |
| POST | `/properties/geocode` | Forward geocoding (address → coordinates) |
| POST | `/properties/reverse-geocode` | Reverse geocoding (coordinates → address) |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `EXPO_PUBLIC_PROPERTY_MAX_PHOTOS` | Maximum photos per property | Yes |
| `EXPO_PUBLIC_PROPERTY_PHOTO_MAX_SIZE_MB` | Max photo file size (MB) | Yes |
| `EXPO_PUBLIC_PROPERTY_PHOTO_MAX_DIMENSION_PX` | Max photo dimension (resized before upload) | Yes |
| `EXPO_PUBLIC_PROPERTY_UPLOAD_TIMEOUT_MS` | Upload timeout | Yes |
| `EXPO_PUBLIC_PROPERTY_MAX_SQM` | Max square meters | Yes |
| `EXPO_PUBLIC_PROPERTY_MAX_BEDROOMS` | Max bedrooms | Yes |
| `EXPO_PUBLIC_PROPERTY_MAX_BATHROOMS` | Max bathrooms | Yes |
| `EXPO_PUBLIC_PROPERTY_MAX_CHECKLIST_ITEMS` | Max checklist items | Yes |
| `EXPO_PUBLIC_PROPERTY_MAX_REQUIREMENTS` | Max special requirements | Yes |

## Design System

Uses the BidClean design system tokens (see `src/theme/`):
- Dark mode background, accent color for CTAs and actions
- Card surfaces use container background tokens
- Maps use Mapbox custom dark style
- All UI text uses i18n keys (prefix: `properties.*`)
- Typography: project custom font (see theme config)
- Animations: Reanimated 3 with spring physics

## State Management

```
Zustand Store: useProperties
├── items (PropertyListItem[] — current page)
├── total / currentPage / totalPages
├── selectedProperty (Property | null — full detail)
├── isListLoading / isDetailLoading / isMutating
├── error (i18n key | null)
├── fetchList(query?)
├── fetchDetail(propertyId)
├── createProperty(payload) — uses Idempotency-Key
├── updateProperty(propertyId, payload)
├── deleteProperty(propertyId)
├── uploadPhoto(propertyId, imageUri) — uses Idempotency-Key
├── deletePhoto(propertyId, photoId)
├── reorderPhotos(propertyId, payload)
├── geocode(request) — forward geocoding
├── reverseGeocode(request) — reverse geocoding
├── clearError()
└── reset()
```

## Related Modules

- **Backend**: `services/api/src/properties/` — NestJS property module (CRUD, photos, geocoding)
- **Offer publishing**: Properties are required before creating an offer (offer-ready state)
- **Navigation**: `src/navigation/HostNavigator.tsx` — Properties tab in Host bottom navigator
