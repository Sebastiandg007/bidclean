# Requirements Document

## Introduction

BidClean users have profiles that contain personal data, role-specific information, and private settings. Each role (Host/Cleaner) has a distinct profile view with different data fields. The profile is accessible via the Profile tab in both Host and Cleaner navigators. Some profile data is publicly visible to other users (when viewing a Host or Cleaner card), while sensitive fields remain private. The profile module also manages settings (language, theme, notifications) and account operations (email change, password change via Keycloak, account deletion). Role-specific fields (business_name, specialties, work_zone, availability) are stored in the existing `host_profiles` and `cleaner_profiles` tables created by the user-roles spec — the profile module reads and writes to those tables but does not own or re-create them.

## Glossary

| Term | Definition |
|------|-----------|
| Public Profile | The subset of profile data visible to other users (name, photo, bio, ratings, specialties) |
| Private Profile | The full profile including sensitive fields (email, phone, settings) — visible only to the owner |
| Profile Completeness | A percentage indicator showing how many optional fields the user has filled |
| Host Profile | Role-specific profile data for property owners (business info, properties count, payment methods overview) |
| Cleaner Profile | Role-specific profile data for cleaning professionals (specialties, work zone, availability, bio, portfolio, ratings, KYC badge) |
| Portfolio Gallery | A collection of before/after photos uploaded by a Cleaner to showcase their work |
| KYC Badge | A visual indicator that a Cleaner has passed identity verification |
| Profile Photo | The user's avatar image stored encrypted in MinIO (separate bucket from KYC documents) |
| Settings | User preferences for language, theme (dark/light), and notification channels |
| Deletion Job | An async background job (BullMQ) that executes account deletion steps after the user requests it |

## Requirements

### REQ-1: Personal Data Management
- The system shall allow users to view and edit their personal information: display name, phone number, and profile photo
- Display name is required (non-empty, max length configurable via env: `PROFILE_NAME_MAX_LENGTH`)
- Email is read-only in the profile screen — it is a denormalized cache from Keycloak (Keycloak is the source of truth)
- Phone number is optional (nullable) — some countries require it for verification
- Phone number format is validated against E.164 standard when provided
- All personal data changes are persisted to the BidClean database (`profile_details` table)
- Profile data is loaded on app start and cached locally (Zustand store)

### REQ-2: Profile Photo Upload
- The system shall allow users to upload a profile photo from their device gallery or camera
- Supported formats: JPEG, PNG, WebP
- Maximum file size is configurable (env: `PROFILE_PHOTO_MAX_SIZE_MB`)
- Photos are resized to a configurable maximum dimension (env: `PROFILE_PHOTO_MAX_DIMENSION_PX`) before upload
- Photos are stored encrypted in MinIO in a dedicated bucket (env: `MINIO_PROFILE_PHOTOS_BUCKET`)
- The system returns a signed URL for photo display (configurable expiration via env: `PROFILE_PHOTO_URL_EXPIRY_SECONDS`)
- The mobile client must detect expired signed URLs and request fresh ones; cached URLs respect the URL expiry time
- Uploading a new photo replaces the previous one (old photo is deleted from MinIO)
- Profile photo is visible publicly to other users

### REQ-3: Host Profile Data
- When a user is in Host mode, their profile displays Host-specific information:
  - Business name (optional — for companies, stored in `host_profiles.business_name`)
  - Number of properties registered
  - Payment methods overview (count of active payment methods, last 4 digits — no full card data stored)
  - Member since date
  - Average rating received from Cleaners (read-only, derived from service history)
  - Total completed services count (read-only, derived from service history)
- Business name is editable via a dedicated Host PATCH endpoint
- Properties count and payment methods are read-only aggregates (computed from other modules)
- Ratings and service counts are read-only (display only, data comes from service history module)
- The profile module NEVER stores card numbers, CVVs, expiration dates, or bank credentials. Payment method overview is consumed as a read-only aggregate from Stripe/stripe-escrow module.

### REQ-4: Cleaner Profile Data
- When a user is in Cleaner mode, their profile displays Cleaner-specific information:
  - Specialties (array of cleaning categories: configurable list via backend constants, stored in `cleaner_profiles.specialties`)
  - Work zone (center point + radius in km, stored in `cleaner_profiles.work_zone_center` and `cleaner_profiles.work_zone_radius_km`)
  - Availability schedule (days and time ranges, stored in `cleaner_profiles.availability`)
  - Bio (optional, max length configurable via env: `PROFILE_BIO_MAX_LENGTH`, visible on the Cleaner's public profile, stored in `profile_details.bio`)
  - Portfolio gallery (before/after photos, max count configurable via env: `PROFILE_MAX_PORTFOLIO_PHOTOS`)
  - Average rating from Hosts (read-only, derived from service history)
  - Total completed services count (read-only, derived from service history)
  - KYC verification badge (VERIFIED status = badge displayed)
  - Member since date
- Specialties, work zone, availability, and bio are editable via a dedicated Cleaner PATCH endpoint
- Portfolio photos are uploaded to MinIO (same bucket as profile photos, subfolder per user)
- Portfolio photos are publicly visible to Hosts viewing the Cleaner's profile
- Portfolio completeness is derived from `COUNT(*)` on `portfolio_photos` table — no boolean is stored
- KYC badge is read-only (derived from kyc_verifications latest attempt status)

### REQ-5: Profile Completeness Indicator
- The system shall calculate and display a profile completeness percentage
- Completeness is calculated differently per role using configurable field weights (env: `PROFILE_COMPLETENESS_WEIGHTS_HOST`, `PROFILE_COMPLETENESS_WEIGHTS_CLEANER`)
- Default Host fields: name, photo, business name, payment method, first property
- Default Cleaner fields: name, photo, specialties, work zone, availability, portfolio, KYC verified, bio (optional weight)
- Completeness percentage updates in real-time as the user fills fields
- A progress bar or ring with percentage is displayed on the profile screen
- Reaching full completeness is encouraged but not required to use the app

### REQ-6: Settings Screen
- The settings screen allows users to configure:
  - Language preference (from supported languages configured in the app)
  - Theme preference (dark/light/system)
  - Notification preferences (push enabled/disabled, email notifications enabled/disabled, in-app sounds enabled/disabled)
- Language change updates the app UI immediately (i18n reload)
- Theme change applies immediately (no restart required)
- Notification preferences are synced to the backend (for server-side notification decisions)
- Settings are stored both locally (for offline access) and on the backend (for cross-device sync)

### REQ-7: Change Email
- The system shall provide a flow to change the user's email address
- Email change is delegated to Keycloak (not handled by BidClean directly)
- The app opens the system browser (not WebView) for the Keycloak email change flow, consistent with the auth spec
- Keycloak Event Listener sends a webhook to a NestJS endpoint when email changes
- The NestJS endpoint updates `users.email` (denormalized cache) — Keycloak remains the source of truth
- The user must verify the new email before it becomes active

### REQ-8: Change Password
- The system shall provide a flow to change the user's password
- Password change is delegated to Keycloak (not handled by BidClean directly)
- The app opens the system browser (not WebView) for the Keycloak password change flow, consistent with the auth spec
- No password data is stored in BidClean — all password management is in Keycloak

### REQ-9: Delete Account (Async)
- The system shall allow users to request permanent deletion of their account
- Account deletion requires confirmation (user must type a configurable confirmation word)
- Before accepting the request, the system validates:
  - No active offers/services in progress
  - Confirmation word matches (configurable via env: `PROFILE_DELETE_CONFIRMATION_WORD`)
- Upon valid request:
  - The user is marked as `DELETION_PENDING` in the `users` table (`deletion_status` column)
  - Login is disabled immediately (Keycloak account disabled)
  - An async deletion job is enqueued (BullMQ queue)
- The async deletion job executes:
  - Cancel active subscriptions (RevenueCat API)
  - Delete user from Keycloak (Admin API)
  - Delete all MinIO files (profile photos, portfolio, KYC documents)
  - Anonymize PII in database: email→null, phone→null, display_name→"Deleted User", photo→removed
  - Keep minimum records for audit (soft-delete + anonymize, not hard delete)
- The deletion job has retries, idempotency keys, audit logging, and dead-letter queue on permanent failure
- After the deletion request is accepted, the user is logged out and returned to the Welcome screen
- Deletion is irreversible — user is informed clearly before confirming

### REQ-10: Public Profile View
- When another user views a profile (e.g., Host viewing a Cleaner card, or Cleaner viewing a Host card), only public fields are shown
- The public profile endpoint uses a dedicated repository method `findPublicProfile(userId)` that SELECTs only public columns — it NEVER uses SELECT * and filters
- Public fields returned:
  - Common: display_name, photo_storage_key (as signed URL), member_since
  - Host public: business_name
  - Cleaner public: bio, specialties, work_zone_label, portfolio gallery, KYC badge status
- Private fields NEVER exposed in public views: email, phone_number, settings, exact work_zone_center coordinates
- Work zone in public view shows only the general area name (city/neighborhood via `work_zone_label`), not the exact center point

### REQ-11: Role Switch Display
- The profile screen displays a role switch button for users with both roles (Host + Cleaner)
- The role switch functionality is already implemented in the user-roles spec
- The profile screen only renders the switch UI component and triggers the existing role switch action
- If the user has only one role, the switch button is hidden and replaced by "Add second role" option

### REQ-12: Add Second Role Display
- The profile screen displays an "Add second role" option for users with only one role
- Tapping this option triggers the role-specific onboarding flow (already implemented in user-roles spec)
- After completing onboarding for the second role, the profile screen updates to show the role switch button

## Non-Functional Requirements

- Profile data loads within configurable timeout on standard mobile connection
- Profile photo upload completes within configurable timeout (env: `PROFILE_UPLOAD_TIMEOUT_MS`)
- Portfolio gallery supports lazy loading with pagination
- Settings changes apply immediately (no perceptible delay)
- All profile text uses i18n keys (no hardcoded strings)
- Profile photo signed URLs are cached locally; cache respects the URL expiry time
- Profile API responses are paginated where applicable (portfolio gallery)
- All profile endpoints are rate-limited (configurable via env: `PROFILE_RATE_LIMIT_PER_MINUTE`)
- On application boot, the completeness service validates that `sum(weights) === 100` for both Host and Cleaner weight configurations. If validation fails, the application must fail fast with a clear error message identifying which weight set is invalid.
- The profile module NEVER stores payment card numbers, CVVs, expiration dates, or bank credentials anywhere in its data layer

## Out of Scope

- Ratings/reviews creation and management → `service-history` spec
- Payment method management details → `stripe-escrow` spec
- Property creation and management → `property-management` spec
- KYC verification flow → `kyc-verification` spec (only badge display here)
- Role switch logic → `user-roles` spec (only UI display here)
- Role onboarding flows → `user-roles` spec (only trigger here)
- Admin panel for user management → `admin-panel` spec
- Social features (follow, message from profile) → future spec
- Profile SEO/web view → future spec (mobile-only for v1)
- Cleaner availability calendar integration with external calendars → future spec
