# Design Document

## Overview

The user profile system uses a two-layer architecture: the NestJS API manages profile data persistence, photo storage, settings, and account operations, while the React Native mobile app provides role-specific profile views, settings screens, and account management UI. Profile photos and portfolio images are stored encrypted in MinIO (separate bucket from KYC). Email/password changes are delegated to Keycloak. Account deletion cascades across Keycloak, PostgreSQL, and MinIO. Public profile views expose only non-sensitive fields.

### Responsibility Matrix

| Responsibility | Mobile App | NestJS API | Keycloak | MinIO |
|----------------|-----------|------------|----------|-------|
| Profile display (own) | ✅ | ❌ | ❌ | ❌ |
| Profile editing | ✅ (UI) | ✅ (persist) | ❌ | ❌ |
| Profile photo upload | ✅ (capture/select) | ✅ (store) | ❌ | ✅ (storage) |
| Portfolio management | ✅ (UI) | ✅ (persist) | ❌ | ✅ (storage) |
| Settings management | ✅ (local + sync) | ✅ (persist) | ❌ | ❌ |
| Email change | ✅ (redirect) | ✅ (sync) | ✅ (manage) | ❌ |
| Password change | ✅ (redirect) | ❌ | ✅ (manage) | ❌ |
| Account deletion | ✅ (confirm) | ✅ (orchestrate) | ✅ (delete) | ✅ (cleanup) |
| Public profile serving | ❌ | ✅ | ❌ | ❌ |
| Profile completeness | ✅ (display) | ✅ (calculate) | ❌ | ❌ |
| Role switch/add display | ✅ | ❌ | ❌ | ❌ |

## Architecture

The profile module follows a CRUD-centric pattern with role-specific data separation. The mobile app fetches the full private profile on login and subscribes to local state. Public profile requests go through a separate endpoint that strips private fields.

```
Mobile App (Expo)
├── Profile Screen (Host view / Cleaner view depending on active role)
├── Edit Profile Screen (personal data + role-specific fields)
├── Settings Screen (language, theme, notifications)
├── Account Management Screen (email, password, delete)
├── Portfolio Gallery Screen (Cleaner only — upload/manage photos)
└── Public Profile View (when viewing another user's profile)
        ↓ API calls
NestJS API (profile module)
├── GET /profile/me — full private profile (role-specific fields included)
├── PATCH /profile/me — update personal data + role-specific fields
├── POST /profile/me/photo — upload profile photo
├── DELETE /profile/me/photo — remove profile photo
├── GET /profile/me/completeness — profile completeness percentage
├── GET /profile/:userId — public profile (filtered fields)
├── POST /profile/me/portfolio — upload portfolio photo (Cleaner)
├── DELETE /profile/me/portfolio/:photoId — remove portfolio photo
├── GET /profile/me/settings — get user settings
├── PATCH /profile/me/settings — update user settings
├── POST /profile/me/change-email — initiate Keycloak email change
├── POST /profile/me/change-password — initiate Keycloak password change
├── POST /profile/me/delete-account — delete account (cascade)
        ↓ storage
MinIO (encrypted object storage)
├── Bucket: configurable (env: MINIO_PROFILE_PHOTOS_BUCKET)
│   ├── {userId}/avatar.{ext}
│   └── {userId}/portfolio/{photoId}.{ext}
        ↓ auth delegation
Keycloak
├── Email change flow
├── Password change flow
└── Account deletion (via Admin API)
```

## Components and Interfaces

### API Endpoints (NestJS)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/profile/me` | Get own full profile (private, includes role-specific data) | Access token |
| PATCH | `/profile/me` | Update own profile fields | Access token |
| POST | `/profile/me/photo` | Upload profile photo (multipart) | Access token |
| DELETE | `/profile/me/photo` | Remove own profile photo | Access token |
| GET | `/profile/me/completeness` | Get profile completeness percentage | Access token |
| GET | `/profile/:userId` | Get public profile of another user | Access token |
| POST | `/profile/me/portfolio` | Upload portfolio photo (Cleaner only) | Access token (Cleaner role) |
| DELETE | `/profile/me/portfolio/:photoId` | Remove portfolio photo | Access token (Cleaner role) |
| GET | `/profile/me/settings` | Get user settings | Access token |
| PATCH | `/profile/me/settings` | Update user settings | Access token |
| POST | `/profile/me/change-email` | Initiate email change via Keycloak | Access token |
| POST | `/profile/me/change-password` | Get Keycloak password change URL | Access token |
| POST | `/profile/me/delete-account` | Delete account with cascade | Access token |

### Component Structure (Backend — NestJS)

```
services/api/src/profile/
├── profile.module.ts
├── profile.controller.ts
├── profile.service.ts
├── profile.types.ts
├── photo/
│   ├── profile-photo.service.ts
│   └── profile-photo.types.ts
├── portfolio/
│   ├── portfolio.service.ts
│   └── portfolio.types.ts
├── settings/
│   ├── settings.service.ts
│   └── settings.types.ts
├── account/
│   ├── account.service.ts
│   └── account.types.ts
├── completeness/
│   ├── completeness.service.ts
│   └── completeness.types.ts
├── dto/
│   ├── update-profile.dto.ts
│   ├── upload-photo.dto.ts
│   ├── update-settings.dto.ts
│   ├── delete-account.dto.ts
│   └── public-profile.dto.ts
├── entities/
│   ├── profile-details.entity.ts
│   ├── user-settings.entity.ts
│   └── portfolio-photo.entity.ts
├── __tests__/
│   ├── profile.service.spec.ts
│   ├── profile-photo.service.spec.ts
│   ├── portfolio.service.spec.ts
│   ├── settings.service.spec.ts
│   ├── account.service.spec.ts
│   └── completeness.service.spec.ts
└── README.md
```

### Component Structure (Mobile)

```
apps/mobile/src/screens/profile/
├── ProfileScreen.tsx (main profile — renders Host or Cleaner view)
├── EditProfileScreen.tsx (edit personal + role-specific data)
├── SettingsScreen.tsx (language, theme, notifications)
├── AccountScreen.tsx (email change, password change, delete account)
├── PortfolioGalleryScreen.tsx (Cleaner portfolio management)
├── PublicProfileScreen.tsx (viewing another user's profile)
├── useProfile.ts (Zustand store hook + API calls)
├── useSettings.ts (settings store hook + sync)
├── profile.types.ts
├── profile.constants.ts
├── components/
│   ├── ProfileHeader.tsx (photo, name, completeness ring)
│   ├── HostProfileCard.tsx (Host-specific fields)
│   ├── CleanerProfileCard.tsx (Cleaner-specific fields)
│   ├── CompletenessRing.tsx (animated progress ring)
│   ├── RoleSwitchButton.tsx (integrates with user-roles)
│   ├── AddSecondRoleButton.tsx (links to role onboarding)
│   ├── SettingsItem.tsx (reusable settings row)
│   ├── PortfolioGrid.tsx (photo grid with upload action)
│   └── DeleteAccountModal.tsx (confirmation dialog)
├── __tests__/
│   ├── ProfileScreen.spec.tsx
│   ├── EditProfileScreen.spec.tsx
│   ├── SettingsScreen.spec.tsx
│   ├── AccountScreen.spec.tsx
│   └── PublicProfileScreen.spec.tsx
└── README.md
```

## Data Models

### Profile Details Table

```sql
CREATE TABLE profile_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20),
    photo_storage_key VARCHAR(512),
    business_name VARCHAR(255),
    specialties VARCHAR(50)[],
    work_zone_center GEOGRAPHY(POINT, 4326),
    work_zone_radius_km NUMERIC(6,2),
    work_zone_label VARCHAR(255),
    availability JSONB,
    bio TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_profile_details_user UNIQUE(user_id)
);

CREATE INDEX idx_profile_details_user ON profile_details(user_id);
```

### User Settings Table

```sql
CREATE TABLE user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    language VARCHAR(35) NOT NULL DEFAULT 'en',
    theme VARCHAR(10) NOT NULL DEFAULT 'system',
    is_push_enabled BOOLEAN NOT NULL DEFAULT true,
    is_email_notifications_enabled BOOLEAN NOT NULL DEFAULT true,
    is_sounds_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_user_settings_user UNIQUE(user_id),
    CONSTRAINT chk_theme CHECK (theme IN ('dark', 'light', 'system'))
);

CREATE INDEX idx_user_settings_user ON user_settings(user_id);
```

### Portfolio Photos Table

```sql
CREATE TABLE portfolio_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_key VARCHAR(512) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    caption VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_portfolio_photos_key UNIQUE(storage_key)
);

CREATE INDEX idx_portfolio_photos_user ON portfolio_photos(user_id);
CREATE INDEX idx_portfolio_photos_order ON portfolio_photos(user_id, display_order);
```

### Data Relationships

```
users (from user-authentication)
├── profile_details (1:1, ON DELETE CASCADE)
├── user_settings (1:1, ON DELETE CASCADE)
├── portfolio_photos (1:N, ON DELETE CASCADE)
├── kyc_verifications (1:N, from kyc-verification — read-only here)
└── user_roles (1:N, from user-roles — read-only here)
```

### Availability JSONB Schema

```json
{
  "monday": { "enabled": true, "start": "08:00", "end": "18:00" },
  "tuesday": { "enabled": true, "start": "08:00", "end": "18:00" },
  "wednesday": { "enabled": false, "start": null, "end": null },
  "thursday": { "enabled": true, "start": "09:00", "end": "17:00" },
  "friday": { "enabled": true, "start": "08:00", "end": "20:00" },
  "saturday": { "enabled": true, "start": "10:00", "end": "14:00" },
  "sunday": { "enabled": false, "start": null, "end": null }
}
```

## Profile Completeness Calculation

### Host Completeness Fields

| Field | Condition | Source |
|-------|-----------|--------|
| Display name | Non-empty | profile_details.display_name |
| Profile photo | Photo exists | profile_details.photo_storage_key IS NOT NULL |
| Business name | Non-empty | profile_details.business_name IS NOT NULL |
| Payment method | Has active method | Stripe API (aggregate) |
| First property | Has at least one | Properties table (count) |

### Cleaner Completeness Fields

| Field | Condition | Source |
|-------|-----------|--------|
| Display name | Non-empty | profile_details.display_name |
| Profile photo | Photo exists | profile_details.photo_storage_key IS NOT NULL |
| Specialties | At least one | profile_details.specialties array length > 0 |
| Work zone | Center + radius set | profile_details.work_zone_center IS NOT NULL |
| Availability | At least one day enabled | profile_details.availability has enabled days |
| Portfolio | At least one photo | portfolio_photos count > 0 |
| KYC verified | Status = VERIFIED | kyc_verifications latest status |

> **Note:** Field weights for completeness calculation are configurable via environment variables (`PROFILE_COMPLETENESS_WEIGHTS_HOST`, `PROFILE_COMPLETENESS_WEIGHTS_CLEANER`) as JSON objects mapping field names to weight values.

## Account Deletion Flow

```
1. User taps "Delete Account" on Account screen
        ↓
2. DeleteAccountModal displayed with warnings and confirmation input
        ↓
3. User types confirmation word and confirms
        ↓
4. POST /profile/me/delete-account (with confirmation in body)
        ↓
5. Backend validates:
   - No active offers/services in progress
   - Confirmation word matches (configurable via env: PROFILE_DELETE_CONFIRMATION_WORD)
        ↓
6. Cancellation cascade (with compensating action pattern):
   a. Cancel active subscriptions (RevenueCat API)
   b. Delete user from Keycloak (Admin API)
   c. Delete all MinIO files (profile photos, portfolio, KYC docs)
   d. Soft-delete user record in PostgreSQL (set deleted_at)
   e. Related records cascade (profile_details, settings, portfolio_photos)
        ↓
7. Return success → app logs out → navigate to Welcome screen
```

> **Note:** Deletion steps (a-e) are executed with a compensating action pattern. If Keycloak deletion fails, the process is aborted. If MinIO deletion fails after Keycloak deletion, the failure is logged and retried via a background job (eventual consistency).

## Error Handling

| Error Case | HTTP Status | Response |
|-----------|-------------|----------|
| Profile not found | 404 | Profile not found (i18n: `profile.error.not_found`) |
| Invalid phone format | 400 | Invalid phone number (i18n: `profile.error.invalid_phone`) |
| Photo too large | 413 | File exceeds max size (i18n: `profile.error.photo_too_large`) |
| Unsupported photo format | 400 | Unsupported file type (i18n: `profile.error.invalid_photo_type`) |
| Portfolio max reached | 400 | Portfolio limit reached (i18n: `profile.error.portfolio_max`) |
| Portfolio photo not found | 404 | Photo not found (i18n: `profile.error.photo_not_found`) |
| User not found (public view) | 404 | User not found (i18n: `profile.error.user_not_found`) |
| Active services block deletion | 409 | Active services exist (i18n: `profile.error.active_services`) |
| Invalid confirmation word | 400 | Invalid confirmation (i18n: `profile.error.invalid_confirmation`) |
| Keycloak email change failed | 502 | Email change failed (i18n: `profile.error.email_change_failed`) |
| Keycloak password change failed | 502 | Password change failed (i18n: `profile.error.password_change_failed`) |
| Keycloak deletion failed | 502 | Account deletion failed (i18n: `profile.error.deletion_failed`) |
| Not a Cleaner (portfolio upload) | 403 | Requires Cleaner role (i18n: `profile.error.not_cleaner`) |
| Settings validation failed | 400 | Invalid settings (i18n: `profile.error.invalid_settings`) |

## Testing Strategy

### Unit Tests (NestJS)
- Profile service: CRUD operations, field validation, role-specific data filtering
- Profile photo service: upload flow, replacement (old deleted), signed URL generation, deletion
- Portfolio service: upload, reorder, delete, max count validation
- Settings service: create defaults, update, validation (valid theme, valid language)
- Account service: deletion flow, cascade verification, active services check
- Completeness service: calculation per role, edge cases (no data), field weight application

### Component Tests (Mobile)
- ProfileScreen: renders Host view vs Cleaner view based on active role, completeness ring
- EditProfileScreen: form validation, phone format, save behavior
- SettingsScreen: language change triggers i18n reload, theme change applies immediately
- AccountScreen: delete confirmation modal, email/password redirect behavior
- PublicProfileScreen: only public fields displayed, no private data leakage

### Integration Tests
- Full profile CRUD: create profile → update fields → verify persistence
- Photo upload: upload photo → verify MinIO storage → get signed URL → display
- Account deletion: create user → add data → delete → verify cascade (DB + MinIO)
- Public vs private: create profile → get own (full data) → get public (filtered data)
- Settings sync: update settings → verify local + backend persistence

## Correctness Properties

### Property 1: Private Field Isolation
The public profile endpoint (`GET /profile/:userId`) NEVER returns email, phone number, settings, or exact work zone coordinates. These fields are structurally excluded from the public DTO at the type level.

**Validates: Requirements 10**

### Property 2: Photo Storage Encryption
All profile photos and portfolio images stored in MinIO are encrypted at rest. No unencrypted user images exist in persistent storage.

**Validates: Requirements 2, 4**

### Property 3: Cascading Deletion Completeness
When an account is deleted, ALL user data is removed from ALL systems: Keycloak account, MinIO files (photos, portfolio, KYC documents), and database records (soft-delete with cascade). No orphaned data remains.

**Validates: Requirements 9**

### Property 4: Active Service Deletion Guard
Account deletion is blocked while any offer or service involving the user is in an active/in-progress state. The system never allows deletion that would leave counterparties in an undefined state.

**Validates: Requirements 9**

### Property 5: Keycloak Authority for Credentials
Email and password are NEVER stored or managed in BidClean's database. All credential changes flow through Keycloak. The BidClean database only stores a sync copy of the email for display purposes.

**Validates: Requirements 7, 8**

### Property 6: Profile Completeness Accuracy
The profile completeness percentage always reflects the actual current state of the user's data. It is recalculated on every request (not cached stale) based on current field values across all relevant tables.

**Validates: Requirements 5**

### Property 7: Role-Specific Field Visibility
Host-specific fields (business name, properties count, payment methods) are never visible in Cleaner profile view, and vice versa. The active role determines which fields are included in the API response.

**Validates: Requirements 3, 4, 10**

### Property 8: Photo Replacement Atomicity
When a new profile photo is uploaded, the old photo is deleted from MinIO before or as part of the same operation. No scenario exists where two profile photos coexist for the same user (except during the upload transaction window).

**Validates: Requirements 2**

## Dependencies

### Backend (NestJS)
- Existing `users` table from `user-authentication` spec
- JWT auth guard (from auth module)
- Role guard (from roles module — Cleaner role required for portfolio)
- MinIO client (`minio` npm package) for encrypted object storage
- Keycloak Admin Client (`@keycloak/keycloak-admin-client`) for email change and account deletion
- RevenueCat SDK for subscription cancellation on account deletion
- `class-validator` + `class-transformer` for DTO validation
- `sharp` for image resizing before MinIO upload

### Mobile
- `expo-image-picker` — Photo selection from gallery/camera
- `expo-image-manipulator` — Client-side image resizing
- Zustand store for profile state management
- Reanimated 3 for completeness ring animation
- React Navigation (profile tab already exists in navigators)
- Existing `RoleSwitchButton` and `AddSecondRoleButton` from user-roles screens
- i18n setup from existing localization infrastructure

### External Services
- MinIO: encrypted storage for photos and portfolio
- Keycloak: email/password management, account deletion
- RevenueCat: subscription cancellation on delete
- Stripe: read-only payment methods overview (from stripe-escrow module)
