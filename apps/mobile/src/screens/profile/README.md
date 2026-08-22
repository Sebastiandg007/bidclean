# Profile Screens

## Purpose

User profile management screens for BidClean. This module provides the UI for viewing and editing personal data, role-specific profile information (Host/Cleaner), settings management (language, theme, notifications), account operations (email change, password change, account deletion), portfolio management (Cleaner), and public profile display. Renders different views based on the user's active role.

## Flow

```
Profile Tab (Host or Cleaner navigator)
  → ProfileScreen (main view — renders Host or Cleaner card based on active role)
  → EditProfileScreen (edit personal + role-specific data)
  → SettingsScreen (language, theme, notifications)
  → AccountScreen (email change, password change, delete account)
  → PortfolioGalleryScreen (Cleaner — manage portfolio photos)

Viewing another user's profile:
  → PublicProfileScreen (public fields only via dedicated endpoint)
```

## Files

| File | Responsibility |
|------|---------------|
| `ProfileScreen.tsx` | Main profile view — conditionally renders Host or Cleaner card based on active role, includes completeness ring |
| `EditProfileScreen.tsx` | Form for editing personal data + role-specific fields (phone E.164 validation, specialties picker, work zone selector, availability scheduler, bio input), saves via split PATCH endpoints (common/host/cleaner) |
| `SettingsScreen.tsx` | Language selector, theme toggle, notification preferences |
| `AccountScreen.tsx` | Email change (system browser), password change (system browser), delete account |
| `PortfolioGalleryScreen.tsx` | Cleaner portfolio photo grid with upload, reorder, and delete |
| `PublicProfileScreen.tsx` | View another user's public profile (public fields only) |
| `useProfile.ts` | Zustand store hook + API calls for profile data |
| `useSettings.ts` | Settings store hook + backend sync |
| `useSignedUrl.ts` | Hook that detects expired signed URLs and requests fresh ones |
| `profile.types.ts` | Shared TypeScript types for profile screens |
| `profile.constants.ts` | Design tokens, route names, validation limits (from env) |

## Components

| File | Responsibility |
|------|---------------|
| `components/ProfileHeader.tsx` | Photo, name, and completeness ring display |
| `components/HostProfileCard.tsx` | Host-specific fields (business name, properties count, payment overview) |
| `components/CleanerProfileCard.tsx` | Cleaner-specific fields (specialties, work zone, availability, bio, portfolio preview) |
| `components/CompletenessRing.tsx` | Animated SVG progress ring with percentage |
| `components/RoleSwitchButton.tsx` | Re-export from `screens/roles/RoleSwitchButton` (already implemented) |
| `components/AddSecondRoleButton.tsx` | Re-export from `screens/roles/AddSecondRoleButton` (already implemented) |
| `components/SettingsItem.tsx` | Reusable settings row (icon, label, value/toggle) |
| `components/PortfolioGrid.tsx` | Photo grid with upload action and lazy loading |
| `components/DeleteAccountModal.tsx` | Confirmation dialog with word input for account deletion |

## Tests

| File | Coverage |
|------|----------|
| `__tests__/ProfileScreen.spec.tsx` | Role-based rendering, completeness display, role switch/add button |
| `__tests__/EditProfileScreen.spec.tsx` | Form validation, split endpoint saves, phone E.164 validation |
| `__tests__/SettingsScreen.spec.tsx` | Language/theme/notification changes, immediate UI updates |
| `__tests__/AccountScreen.spec.tsx` | System browser links, delete flow with confirmation modal |
| `__tests__/PortfolioGalleryScreen.spec.tsx` | Empty state, grid rendering, upload trigger, delete confirmation, max photos, API calls |
| `__tests__/PublicProfileScreen.spec.tsx` | Public fields display, signed URL handling, no private data leak |

## Dependencies

- `react-native-reanimated` — Completeness ring animation, transitions
- `react-native-safe-area-context` — Safe area wrapper
- `expo-router` — Navigation between profile screens
- `expo-image-picker` — Profile photo and portfolio upload
- `expo-web-browser` — System browser for Keycloak flows (email/password change)
- `zustand` — Profile and settings state management
- `expo-secure-store` — Local settings persistence for offline access
- API service (`src/services/api.service.ts`) — Profile endpoints
- Role components from `screens/roles/` — RoleSwitchButton, AddSecondRoleButton

## API Endpoints Used

| Method | Path | Description |
|--------|------|-------------|
| GET | `/profile/me` | Get full private profile (includes role-specific data) |
| PATCH | `/profile/me` | Update common fields (display_name, phone_number) |
| PATCH | `/profile/me/host` | Update host-specific fields (business_name) |
| PATCH | `/profile/me/cleaner` | Update cleaner-specific fields (specialties, work_zone, availability, bio) |
| POST | `/profile/me/photo` | Upload profile photo |
| DELETE | `/profile/me/photo` | Remove profile photo |
| GET | `/profile/me/completeness` | Get profile completeness percentage |
| GET | `/profile/:userId` | Get public profile |
| POST | `/profile/me/portfolio` | Upload portfolio photo (Cleaner) |
| DELETE | `/profile/me/portfolio/:photoId` | Remove portfolio photo |
| GET | `/profile/me/settings` | Get user settings |
| PATCH | `/profile/me/settings` | Update user settings |
| POST | `/profile/me/change-email` | Get Keycloak email change URL |
| POST | `/profile/me/change-password` | Get Keycloak password change URL |
| POST | `/profile/me/delete-account` | Request account deletion |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PROFILE_PHOTO_MAX_SIZE_MB` | Maximum profile photo file size | Yes |
| `PROFILE_PHOTO_MAX_DIMENSION_PX` | Maximum photo dimension (resized before upload) | Yes |
| `PROFILE_PHOTO_URL_EXPIRY_SECONDS` | Signed URL cache duration | Yes |
| `PROFILE_MAX_PORTFOLIO_PHOTOS` | Maximum number of portfolio photos | Yes |
| `PROFILE_UPLOAD_TIMEOUT_MS` | Upload timeout for photos | Yes |
| `PROFILE_NAME_MAX_LENGTH` | Maximum display name length | Yes |
| `PROFILE_BIO_MAX_LENGTH` | Maximum bio length | Yes |
| `PROFILE_DELETE_CONFIRMATION_WORD` | Word user must type to confirm deletion | Yes |

## Design System

Uses the BidClean design system tokens (see `src/theme/`):
- Dark mode background, accent color for CTAs and actions
- Card surfaces use container background tokens
- Completeness ring uses accent color for filled portion
- All UI text uses i18n keys (prefix: `profile.*`)
- Typography: project custom font (see theme config)
- Animations: Reanimated 3 with spring physics

## State Management

```
Zustand Store: useProfileStore
├── profile (full private profile data)
├── completeness (percentage + breakdown)
├── isLoading / error
├── fetchProfile()
├── updateCommon(data)
├── updateHost(data)
├── updateCleaner(data)
└── uploadPhoto(file)

Zustand Store: useSettingsStore
├── settings (language, theme, notifications)
├── updateSettings(partial)
├── syncToBackend()
└── loadFromLocal()
```
