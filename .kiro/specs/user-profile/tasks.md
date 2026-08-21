# Implementation Plan

## Overview

Implementation tasks for the User Profile feature. Covers the NestJS backend module (profile CRUD with split PATCH endpoints, photo storage, portfolio, settings, async account deletion via BullMQ, Keycloak email webhook), database migrations (profile_details simplified, user_settings, portfolio_photos, users.deletion_status), and the React Native/Expo mobile screens (profile views, settings, account operations, portfolio gallery). Role-specific fields (business_name, specialties, work_zone, availability) are read/written from existing `host_profiles` and `cleaner_profiles` tables — no migration needed for those.

## Tasks

- [x] 1. Create profile module structure in NestJS (module, controller, service, types, repository, dto/, entities/, photo/, portfolio/, settings/, account/, completeness/, webhooks/, __tests__/, README)
- [x] 2. Create database migration for profile_details table (id, user_id, display_name, phone_number, photo_storage_key, bio, created_at, updated_at — with UNIQUE constraint on user_id, idx_profile_details_user index)
- [x] 3. Create database migration for user_settings table (with UNIQUE constraint on user_id, CHECK constraint on theme, idx_user_settings_user index)
- [x] 4. Create database migration for portfolio_photos table (with UNIQUE constraint on storage_key, composite index on user_id + display_order)
- [x] 5. Create database migration to add deletion_status column to users table (VARCHAR(30), nullable, values: NULL/DELETION_PENDING/DELETED)
- [x] 6. Add profile environment variables to .env.example (MINIO_PROFILE_PHOTOS_BUCKET, PROFILE_PHOTO_MAX_SIZE_MB, PROFILE_PHOTO_MAX_DIMENSION_PX, PROFILE_PHOTO_URL_EXPIRY_SECONDS, PROFILE_MAX_PORTFOLIO_PHOTOS, PROFILE_UPLOAD_TIMEOUT_MS, PROFILE_RATE_LIMIT_PER_MINUTE, PROFILE_NAME_MAX_LENGTH, PROFILE_BIO_MAX_LENGTH, PROFILE_DELETE_CONFIRMATION_WORD, PROFILE_DELETION_MAX_RETRIES, PROFILE_COMPLETENESS_WEIGHTS_HOST, PROFILE_COMPLETENESS_WEIGHTS_CLEANER, KEYCLOAK_WEBHOOK_SECRET)
- [x] 7. Implement profile photo service (MinIO upload with encryption, resize via sharp, signed URL generation with configurable expiry, old photo deletion on replacement, photo removal)
- [x] 8. Implement GET /profile/me endpoint (return full private profile including role-specific fields from host_profiles/cleaner_profiles based on active role, include signed photo URL)
- [x] 9. Implement PATCH /profile/me endpoint (update common fields only: display_name, phone_number — validate phone E.164 format, validate display_name non-empty and max length)
- [x] 10. Implement PATCH /profile/me/host endpoint (update host-specific fields in host_profiles: business_name — Host role guard required)
- [ ] 11. Implement PATCH /profile/me/cleaner endpoint (update cleaner-specific fields in cleaner_profiles: specialties, work_zone_center, work_zone_radius_km, work_zone_label, availability + bio in profile_details — Cleaner role guard, validate specialties array, validate availability JSONB schema, validate bio max length)
- [ ] 12. Implement POST /profile/me/photo endpoint (multipart upload, validate format and size, resize, store in MinIO, update photo_storage_key in profile_details, delete old photo if exists)
- [ ] 13. Implement DELETE /profile/me/photo endpoint (remove photo from MinIO, set photo_storage_key to NULL)
- [ ] 14. Implement GET /profile/:userId public profile endpoint (dedicated repository method findPublicProfile that SELECTs only public columns — display_name, photo_storage_key, member_since, bio, specialties, work_zone_label, KYC badge status — NEVER selects email, phone, settings, exact coordinates)
- [ ] 15. Implement portfolio service (upload photo to MinIO with user subfolder, validate max count from env, manage display_order, delete photo from MinIO + DB, derive portfolio completeness from COUNT(*))
- [ ] 16. Implement POST /profile/me/portfolio and DELETE /profile/me/portfolio/:photoId endpoints (Cleaner role guard, max portfolio count validation, upload/delete with MinIO)
- [ ] 17. Implement profile completeness service (calculate percentage per role using configurable field weights from env, read from profile_details + host_profiles/cleaner_profiles + portfolio_photos COUNT + kyc_verifications + external aggregates)
- [ ] 18. Implement completeness weight validation at boot (onModuleInit: validate sum(weights) === 100 for both Host and Cleaner configs, fail fast with clear error message if invalid)
- [ ] 19. Implement GET /profile/me/completeness endpoint (return percentage + breakdown of completed/incomplete fields per role)
- [ ] 20. Implement settings service (create default settings on user creation, update with validation — valid language codes, valid theme values, boolean notifications)
- [ ] 21. Implement GET /profile/me/settings and PATCH /profile/me/settings endpoints (get settings, update with validation, return updated settings)
- [ ] 22. Implement Keycloak email webhook listener (POST /webhooks/keycloak/email — validate webhook secret, extract email from event payload, update users.email denormalized cache by keycloak_id)
- [ ] 23. Implement account service — change email (POST /profile/me/change-email — generate Keycloak email change URL for system browser, return URL)
- [ ] 24. Implement account service — change password (POST /profile/me/change-password — generate Keycloak password change URL for system browser, return URL)
- [ ] 25. Implement account deletion request handler (POST /profile/me/delete-account — validate confirmation word, check no active services, mark user DELETION_PENDING, disable Keycloak account, enqueue BullMQ job, return 202)
- [ ] 26. Implement async deletion job processor (BullMQ consumer: cancel RevenueCat → delete Keycloak → delete MinIO → anonymize PII in DB → mark DELETED — with retries, idempotency keys, audit logging, dead-letter queue)
- [ ] 27. Create mobile profile screens folder structure with README (screens, components, hooks, types, constants, tests)
- [ ] 28. Implement ProfileScreen (main profile view — conditionally renders HostProfileCard or CleanerProfileCard based on active role, includes ProfileHeader with completeness ring, RoleSwitchButton or AddSecondRoleButton)
- [ ] 29. Implement EditProfileScreen (form for personal data + role-specific fields, phone validation, specialties picker, work zone map selector, availability scheduler, bio input, save via split endpoints: common/host/cleaner)
- [ ] 30. Implement SettingsScreen (language selector with immediate i18n reload, theme toggle with immediate apply, notification preference toggles, sync to backend)
- [ ] 31. Implement AccountScreen (change email button → system browser, change password button → system browser, delete account button → DeleteAccountModal with confirmation input)
- [ ] 32. Implement PortfolioGalleryScreen (grid display of portfolio photos, upload button, reorder via drag, delete with confirmation, lazy loading with pagination)
- [ ] 33. Implement PublicProfileScreen (display public fields only via dedicated endpoint, profile photo with signed URL expiry handling, name, bio, ratings, specialties, portfolio gallery read-only, KYC badge, member since)
- [ ] 34. Create i18n translation files for profile module (en/profile.json, es/profile.json — all screen labels, error messages, settings options, confirmation dialogs)

## Task Dependency Graph

```json
{
  "waves": [
    [1, 2, 3, 4, 5, 6, 27],
    [7, 20, 34],
    [8, 9, 10, 11, 12, 13, 14, 15, 17, 21, 22, 28],
    [16, 18, 19, 23, 24, 29, 30, 33],
    [25, 31, 32],
    [26]
  ]
}
```

## Notes

- Profile details are stored in a separate table (not extending users) to maintain separation of concerns — the users table belongs to the auth module
- The profile_details table is simplified: only id, user_id, display_name, phone_number, photo_storage_key, bio, created_at, updated_at. Role-specific fields live in host_profiles and cleaner_profiles (owned by user-roles spec)
- No migration is needed for host/cleaner role-specific fields (business_name, specialties, work_zone, availability) — those tables already exist from the user-roles spec
- Profile photo uses the same MinIO encryption pattern as KYC documents but a different bucket (env: `MINIO_PROFILE_PHOTOS_BUCKET`)
- Email and password are NEVER stored in BidClean — all credential management is Keycloak's responsibility
- Email sync uses a Keycloak Event Listener webhook → NestJS endpoint pattern. `users.email` is a denormalized cache, NOT the source of truth
- The PATCH endpoint is split into three: /profile/me (common), /profile/me/host (host fields), /profile/me/cleaner (cleaner fields) — this enforces role separation
- Account deletion is fully async: request validates + marks DELETION_PENDING + disables Keycloak + enqueues BullMQ job. The job does the actual cascade with retries, idempotency, and dead-letter queue
- PII anonymization on deletion: email→null, phone→null, display_name→"Deleted User", photo→removed, bio→null. Records are kept for audit (soft-delete + anonymize, not hard delete)
- Profile completeness reads from multiple tables (profile_details, host_profiles/cleaner_profiles, portfolio_photos COUNT, kyc_verifications, Stripe, properties). Computed on request, not cached.
- Portfolio completeness is derived from COUNT(*) on portfolio_photos — never a stored boolean
- On boot, completeness service validates sum(weights) === 100. If not, application fails fast with clear error message
- The public profile endpoint uses `findPublicProfile(userId)` repository method with a dedicated SELECT of only public columns — NEVER SELECT * and filter
- The profile module NEVER stores payment card numbers, CVVs, expiration dates, or bank credentials — payment overview is a read-only aggregate from stripe-escrow
- Signed URLs have configurable expiry; the mobile client (useSignedUrl hook) detects expired URLs and requests fresh ones
- The system browser (not WebView) is used for email and password change flows, consistent with the auth spec
- The RoleSwitchButton and AddSecondRoleButton components already exist from the user-roles spec — they are imported and rendered, not re-implemented
- Settings are stored both locally (Zustand + SecureStore for offline) and on the backend (for cross-device sync)
- All text in the profile screens uses i18n keys — no hardcoded UI strings
- Phone number validation uses E.164 format (with libphonenumber-js or similar)
- Specialties are stored as a VARCHAR[] array in cleaner_profiles; the list of valid specialty values is maintained as backend constants
- Ratings and completed services count are read-only aggregates — they come from the service-history module (not implemented here, just displayed)
- The delete account confirmation word is configurable via env (`PROFILE_DELETE_CONFIRMATION_WORD`) and localized
