# Design Document

## Overview

The user profile system uses a two-layer architecture: the NestJS API manages profile data persistence, photo storage, settings, and account operations, while the React Native mobile app provides role-specific profile views, settings screens, and account management UI. Profile photos and portfolio images are stored encrypted in MinIO (separate bucket from KYC). Email/password changes are delegated to Keycloak via system browser. Account deletion is async — the request marks the user as DELETION_PENDING, disables login, and enqueues a BullMQ job that executes the cascade. Public profile views expose only non-sensitive fields via a dedicated SELECT query. Role-specific fields (business_name, specialties, work_zone, availability) live in existing `host_profiles` and `cleaner_profiles` tables from the user-roles spec — the profile module reads/writes them but does not own those tables.

**Important:** The profile module NEVER stores card numbers, CVVs, expiration dates, or bank credentials. Payment method overview is consumed as a read-only aggregate from Stripe/stripe-escrow module.

### Responsibility Matrix

| Responsibility | Mobile App | NestJS API | Keycloak | MinIO | BullMQ |
|----------------|-----------|------------|----------|-------|--------|
| Profile display (own) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Profile editing (common) | ✅ (UI) | ✅ (persist) | ❌ | ❌ | ❌ |
| Profile editing (host) | ✅ (UI) | ✅ (persist to host_profiles) | ❌ | ❌ | ❌ |
| Profile editing (cleaner) | ✅ (UI) | ✅ (persist to cleaner_profiles) | ❌ | ❌ | ❌ |
| Profile photo upload | ✅ (capture/select) | ✅ (store) | ❌ | ✅ (storage) | ❌ |
| Portfolio management | ✅ (UI) | ✅ (persist) | ❌ | ✅ (storage) | ❌ |
| Settings management | ✅ (local + sync) | ✅ (persist) | ❌ | ❌ | ❌ |
| Email change | ✅ (system browser) | ✅ (webhook listener) | ✅ (manage) | ❌ | ❌ |
| Password change | ✅ (system browser) | ❌ | ✅ (manage) | ❌ | ❌ |
| Account deletion request | ✅ (confirm) | ✅ (validate + enqueue) | ✅ (disable) | ❌ | ❌ |
| Account deletion execution | ❌ | ✅ (job processor) | ✅ (delete) | ✅ (cleanup) | ✅ (queue) |
| Public profile serving | ❌ | ✅ | ❌ | ❌ | ❌ |
| Profile completeness | ✅ (display) | ✅ (calculate) | ❌ | ❌ | ❌ |
| Role switch/add display | ✅ | ❌ | ❌ | ❌ | ❌ |
| Email sync (webhook) | ❌ | ✅ (listener endpoint) | ✅ (event sender) | ❌ | ❌ |

## Architecture

The profile module follows a CRUD-centric pattern with role-specific data separation across three PATCH endpoints. The mobile app fetches the full private profile on login and subscribes to local state. Public profile requests go through a separate endpoint with a dedicated repository method that only SELECTs public columns.

```
Mobile App (Expo)
├── Profile Screen (Host view / Cleaner view depending on active role)
├── Edit Profile Screen (personal data + role-specific fields via split endpoints)
├── Settings Screen (language, theme, notifications)
├── Account Management Screen (email via system browser, password via system browser, delete)
├── Portfolio Gallery Screen (Cleaner only — upload/manage photos)
└── Public Profile View (when viewing another user's profile)
        ↓ API calls
NestJS API (profile module)
├── GET    /profile/me               — full private profile (role-specific fields included)
├── PATCH  /profile/me               — update common fields only (display_name, phone, photo)
├── PATCH  /profile/me/host          — update host-specific fields (business_name)
├── PATCH  /profile/me/cleaner       — update cleaner-specific fields (specialties, work_zone, availability, bio)
├── POST   /profile/me/photo         — upload profile photo
├── DELETE /profile/me/photo         — remove profile photo
├── GET    /profile/me/completeness  — profile completeness percentage
├── GET    /profile/:userId          — public profile (dedicated SELECT query)
├── POST   /profile/me/portfolio     — upload portfolio photo (Cleaner)
├── DELETE /profile/me/portfolio/:photoId — remove portfolio photo
├── GET    /profile/me/settings      — get user settings
├── PATCH  /profile/me/settings      — update user settings
├── POST   /profile/me/change-email  — get Keycloak email change URL (system browser)
├── POST   /profile/me/change-password — get Keycloak password change URL (system browser)
├── POST   /profile/me/delete-account — request deletion (validate → mark pending → enqueue job)
├── POST   /webhooks/keycloak/email  — Keycloak Event Listener webhook for email sync
        ↓ storage
MinIO (encrypted object storage)
├── Bucket: configurable (env: MINIO_PROFILE_PHOTOS_BUCKET)
│   ├── {userId}/avatar.{ext}
│   └── {userId}/portfolio/{photoId}.{ext}
        ↓ auth delegation
Keycloak
├── Email change flow (system browser)
├── Password change flow (system browser)
├── Event Listener → webhook to NestJS on email change
├── Account disable (on deletion request)
└── Account deletion (via Admin API, in async job)
        ↓ async jobs
BullMQ (Redis-backed queue)
├── account-deletion queue
│   ├── Processor: cancel RevenueCat → delete Keycloak → delete MinIO → anonymize DB
│   ├── Retries with exponential backoff
│   ├── Idempotency keys per job
│   ├── Audit logging per step
│   └── Dead-letter queue on permanent failure
```

## Components and Interfaces

### API Endpoints (NestJS)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/profile/me` | Get own full profile (private, includes role-specific data) | Access token |
| PATCH | `/profile/me` | Update common fields (display_name, phone_number, photo_storage_key) | Access token |
| PATCH | `/profile/me/host` | Update host-specific fields (business_name) | Access token (Host role) |
| PATCH | `/profile/me/cleaner` | Update cleaner-specific fields (specialties, work_zone, availability, bio) | Access token (Cleaner role) |
| POST | `/profile/me/photo` | Upload profile photo (multipart) | Access token |
| DELETE | `/profile/me/photo` | Remove own profile photo | Access token |
| GET | `/profile/me/completeness` | Get profile completeness percentage | Access token |
| GET | `/profile/:userId` | Get public profile of another user (dedicated SELECT) | Access token |
| POST | `/profile/me/portfolio` | Upload portfolio photo (Cleaner only) | Access token (Cleaner role) |
| DELETE | `/profile/me/portfolio/:photoId` | Remove portfolio photo | Access token (Cleaner role) |
| GET | `/profile/me/settings` | Get user settings | Access token |
| PATCH | `/profile/me/settings` | Update user settings | Access token |
| POST | `/profile/me/change-email` | Get Keycloak email change URL (system browser) | Access token |
| POST | `/profile/me/change-password` | Get Keycloak password change URL (system browser) | Access token |
| POST | `/profile/me/delete-account` | Request account deletion (async) | Access token |
| POST | `/webhooks/keycloak/email` | Keycloak Event Listener webhook for email sync | Webhook secret |

### Component Structure (Backend — NestJS)

```
services/api/src/profile/
├── profile.module.ts
├── profile.controller.ts
├── profile.service.ts
├── profile.types.ts
├── profile.repository.ts (includes findPublicProfile dedicated query)
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
│   ├── account.types.ts
│   └── deletion-job.processor.ts (BullMQ job processor)
├── completeness/
│   ├── completeness.service.ts
│   ├── completeness.types.ts
│   └── completeness-weight.validator.ts (boot-time validation)
├── webhooks/
│   ├── keycloak-email.controller.ts
│   └── keycloak-email.service.ts
├── dto/
│   ├── update-profile.dto.ts (common fields)
│   ├── update-host-profile.dto.ts
│   ├── update-cleaner-profile.dto.ts
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
│   ├── deletion-job.processor.spec.ts
│   ├── completeness.service.spec.ts
│   └── keycloak-email.service.spec.ts
└── README.md
```

### Component Structure (Mobile)

```
apps/mobile/src/screens/profile/
├── ProfileScreen.tsx (main profile — renders Host or Cleaner view)
├── EditProfileScreen.tsx (edit personal + role-specific data via split endpoints)
├── SettingsScreen.tsx (language, theme, notifications)
├── AccountScreen.tsx (email change via system browser, password change via system browser, delete account)
├── PortfolioGalleryScreen.tsx (Cleaner portfolio management)
├── PublicProfileScreen.tsx (viewing another user's profile)
├── useProfile.ts (Zustand store hook + API calls)
├── useSettings.ts (settings store hook + sync)
├── useSignedUrl.ts (hook that detects expired URLs and requests fresh ones)
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

### Profile Details Table (owned by this module)

```sql
CREATE TABLE profile_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20),
    photo_storage_key VARCHAR(512),
    bio TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_profile_details_user UNIQUE(user_id)
);

CREATE INDEX idx_profile_details_user ON profile_details(user_id);
```

### User Settings Table (owned by this module)

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

### Portfolio Photos Table (owned by this module)

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

### Existing Tables Used (NOT created by this module)

The following tables are owned by the `user-roles` spec and already exist. The profile module reads/writes to them:

- **`host_profiles`** — contains `business_name` (edited via PATCH /profile/me/host)
- **`cleaner_profiles`** — contains `specialties`, `work_zone_center`, `work_zone_radius_km`, `work_zone_label`, `availability` (edited via PATCH /profile/me/cleaner)

### Users Table Addition (migration)

```sql
-- Add deletion_status column for async account deletion
ALTER TABLE users ADD COLUMN deletion_status VARCHAR(30) DEFAULT NULL;
-- Values: NULL (active), 'DELETION_PENDING', 'DELETED'
```

### Data Relationships

```
users (from user-authentication)
├── profile_details (1:1, ON DELETE CASCADE) — owned by this module
├── user_settings (1:1, ON DELETE CASCADE) — owned by this module
├── portfolio_photos (1:N, ON DELETE CASCADE) — owned by this module
├── host_profiles (1:1, from user-roles — read/write here)
├── cleaner_profiles (1:1, from user-roles — read/write here)
├── kyc_verifications (1:N, from kyc-verification — read-only here)
└── user_roles (1:N, from user-roles — read-only here)
```

### Availability JSONB Schema (stored in cleaner_profiles.availability)

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
| Business name | Non-empty | host_profiles.business_name IS NOT NULL |
| Payment method | Has active method | Stripe API (aggregate) |
| First property | Has at least one | Properties table (count) |

### Cleaner Completeness Fields

| Field | Condition | Source |
|-------|-----------|--------|
| Display name | Non-empty | profile_details.display_name |
| Profile photo | Photo exists | profile_details.photo_storage_key IS NOT NULL |
| Specialties | At least one | cleaner_profiles.specialties array length > 0 |
| Work zone | Center + radius set | cleaner_profiles.work_zone_center IS NOT NULL |
| Availability | At least one day enabled | cleaner_profiles.availability has enabled days |
| Portfolio | At least one photo | COUNT(*) on portfolio_photos > 0 |
| KYC verified | Status = VERIFIED | kyc_verifications latest status |
| Bio | Non-empty (optional weight) | profile_details.bio IS NOT NULL AND LENGTH > 0 |

> **Weight Validation:** On application boot, the completeness service validates that `sum(weights) === 100` for both Host and Cleaner configurations. If validation fails, the application fails fast with a clear error message: "Profile completeness weights for {role} sum to {actual}, expected 100."

## Account Deletion Flow (Async)

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
   - No active offers/services in progress → 409 if blocked
   - Confirmation word matches (configurable via env) → 400 if mismatch
        ↓
6. Immediate actions (synchronous in request):
   a. Mark user as DELETION_PENDING in users.deletion_status
   b. Disable user in Keycloak (Admin API — set enabled=false)
   c. Enqueue deletion job to BullMQ (account-deletion queue)
        ↓
7. Return 202 Accepted → app logs out → navigate to Welcome screen
        ↓
8. Async job executes (BullMQ processor):
   a. Cancel active subscriptions (RevenueCat API)
   b. Delete user from Keycloak (Admin API — permanent delete)
   c. Delete all MinIO files (profile photos, portfolio, KYC docs)
   d. Anonymize PII in database:
      - users.email → NULL
      - profile_details.phone_number → NULL
      - profile_details.display_name → "Deleted User"
      - profile_details.photo_storage_key → NULL
      - profile_details.bio → NULL
   e. Set users.deletion_status = 'DELETED'
   f. Log audit entry with timestamp
        ↓
9. On permanent failure → dead-letter queue → alert for manual review
```

> **Job Properties:** Each deletion job carries an idempotency key (user_id). Steps are individually idempotent (safe to retry). The job uses exponential backoff with configurable max retries (env: `PROFILE_DELETION_MAX_RETRIES`). Each step logs to an audit table before and after execution.

## Email Sync Strategy

```
Keycloak Event Listener (SPI plugin or built-in webhook)
        ↓ HTTP POST on email-change event
POST /webhooks/keycloak/email
{
  "userId": "<keycloak-user-id>",
  "type": "UPDATE_EMAIL",
  "details": { "updated_email": "new@example.com" }
}
        ↓ validated via shared webhook secret
NestJS Keycloak Email Webhook Controller
        ↓ updates denormalized cache
UPDATE users SET email = $1 WHERE keycloak_id = $2

Note: users.email is NOT the source of truth — Keycloak is.
This is a denormalized cache for display and notification purposes.
```

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
| Keycloak disable failed | 502 | Account deletion failed (i18n: `profile.error.deletion_failed`) |
| Not a Cleaner (cleaner endpoint) | 403 | Requires Cleaner role (i18n: `profile.error.not_cleaner`) |
| Not a Host (host endpoint) | 403 | Requires Host role (i18n: `profile.error.not_host`) |
| Settings validation failed | 400 | Invalid settings (i18n: `profile.error.invalid_settings`) |
| Webhook secret mismatch | 401 | Unauthorized webhook (no message) |
| Bio too long | 400 | Bio exceeds max length (i18n: `profile.error.bio_too_long`) |
| Completeness weights invalid | 500 | Application fails to start (logged) |

## Testing Strategy

### Unit Tests (NestJS)
- Profile service: CRUD operations, field validation, role-specific data filtering
- Profile photo service: upload flow, replacement (old deleted), signed URL generation, deletion
- Portfolio service: upload, reorder, delete, max count validation, completeness derived from COUNT(*)
- Settings service: create defaults, update, validation (valid theme, valid language)
- Account service: deletion request validation, DELETION_PENDING marking, job enqueue, Keycloak disable
- Deletion job processor: full cascade execution, idempotency, retry behavior, audit logging
- Completeness service: calculation per role, edge cases (no data), field weight application, boot-time weight validation
- Keycloak email webhook: valid event processing, secret validation, user lookup by keycloak_id

### Component Tests (Mobile)
- ProfileScreen: renders Host view vs Cleaner view based on active role, completeness ring
- EditProfileScreen: form validation, phone format, split save to correct endpoints (common/host/cleaner)
- SettingsScreen: language change triggers i18n reload, theme change applies immediately
- AccountScreen: delete confirmation modal, email/password open system browser (not WebView)
- PublicProfileScreen: only public fields displayed, no private data leakage

### Integration Tests
- Full profile CRUD: create profile → update fields via split endpoints → verify persistence in correct tables
- Photo upload: upload photo → verify MinIO storage → get signed URL → verify expiry detection
- Account deletion async: request deletion → verify DELETION_PENDING → process job → verify anonymization
- Public vs private: create profile → get own (full data) → get public (dedicated SELECT, filtered data)
- Settings sync: update settings → verify local + backend persistence
- Email webhook: simulate Keycloak event → verify users.email updated

## Correctness Properties

### Property 1: Private Field Isolation
The public profile endpoint (`GET /profile/:userId`) uses a dedicated repository method `findPublicProfile(userId)` that SELECTs only specific public columns. It NEVER returns email, phone number, settings, or exact work zone coordinates. These fields are structurally excluded at the query level — not filtered post-fetch.

**Validates: Requirements 10**

### Property 2: Photo Storage Encryption
All profile photos and portfolio images stored in MinIO are encrypted at rest. No unencrypted user images exist in persistent storage. Signed URLs have configurable expiry; the mobile client detects expired URLs and requests fresh ones.

**Validates: Requirements 2, 4**

### Property 3: Async Deletion Completeness
When a user requests account deletion, ALL PII is anonymized and external references are cleaned up via an async job. The job is idempotent, retries on transient failure, and lands in a dead-letter queue on permanent failure. No scenario exists where a deletion-requested user retains PII indefinitely.

**Validates: Requirements 9**

### Property 4: Active Service Deletion Guard
Account deletion request is rejected (409) while any offer or service involving the user is in an active/in-progress state. The system never allows deletion that would leave counterparties in an undefined state.

**Validates: Requirements 9**

### Property 5: Keycloak Authority for Credentials
Email and password are NEVER stored or managed in BidClean's database. All credential changes flow through Keycloak via system browser. The `users.email` column is a denormalized cache updated via Keycloak Event Listener webhook — Keycloak remains the single source of truth.

**Validates: Requirements 7, 8**

### Property 6: Profile Completeness Accuracy
The profile completeness percentage always reflects the actual current state of the user's data. It is recalculated on every request based on current field values across profile_details, host_profiles/cleaner_profiles, portfolio_photos (COUNT), and kyc_verifications. Portfolio has a photo is derived from COUNT(*) — never a stored boolean. On boot, weight sums are validated to equal 100.

**Validates: Requirements 5**

### Property 7: Role-Specific Endpoint Separation
Host-specific fields are only editable via `PATCH /profile/me/host` (requires Host role). Cleaner-specific fields are only editable via `PATCH /profile/me/cleaner` (requires Cleaner role). Common fields use `PATCH /profile/me`. No single endpoint handles all field types — this enforces role separation.

**Validates: Requirements 3, 4**

### Property 8: Photo Replacement Atomicity
When a new profile photo is uploaded, the old photo is deleted from MinIO before or as part of the same operation. No scenario exists where two profile photos coexist for the same user (except during the upload transaction window).

**Validates: Requirements 2**

### Property 9: No Payment Data Storage
The profile module NEVER stores card numbers, CVVs, expiration dates, or bank credentials in any table it owns or writes to. Payment method overview is consumed as a read-only aggregate from the stripe-escrow module.

**Validates: Requirements 3**
