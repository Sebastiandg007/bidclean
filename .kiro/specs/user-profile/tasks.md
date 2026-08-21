# Implementation Plan

## Overview

Implementation tasks for the User Profile feature. Covers the NestJS backend module (profile CRUD, photo storage, portfolio, settings, account management), database migrations, and the React Native/Expo mobile screens (profile views, settings, account operations, portfolio gallery).

## Tasks

- [ ] 1. Create profile module structure in NestJS (module, controller, service, types, dto/, entities/, photo/, portfolio/, settings/, account/, completeness/, __tests__/, README)
- [ ] 2. Create database migration for profile_details table (with UNIQUE constraint on user_id, GiST index on work_zone_center, idx_profile_details_user index)
- [ ] 3. Create database migration for user_settings table (with UNIQUE constraint on user_id, CHECK constraint on theme, idx_user_settings_user index)
- [ ] 4. Create database migration for portfolio_photos table (with UNIQUE constraint on storage_key, composite index on user_id + display_order)
- [ ] 5. Add profile environment variables to .env.example (MINIO_PROFILE_PHOTOS_BUCKET, PROFILE_PHOTO_MAX_SIZE_MB, PROFILE_PHOTO_MAX_DIMENSION_PX, PROFILE_PHOTO_URL_EXPIRY_SECONDS, PROFILE_MAX_PORTFOLIO_PHOTOS, PROFILE_UPLOAD_TIMEOUT_MS, PROFILE_RATE_LIMIT_PER_MINUTE, PROFILE_NAME_MAX_LENGTH, PROFILE_DELETE_CONFIRMATION_WORD, PROFILE_COMPLETENESS_WEIGHTS_HOST, PROFILE_COMPLETENESS_WEIGHTS_CLEANER)
- [ ] 6. Implement profile photo service (MinIO upload with encryption, resize via sharp, signed URL generation with configurable expiry, old photo deletion on replacement, photo removal)
- [ ] 7. Implement GET /profile/me endpoint (return full private profile including role-specific fields based on user's active role, include signed photo URL)
- [ ] 8. Implement PATCH /profile/me endpoint (update personal data + role-specific fields, validate phone E.164 format, validate specialties array, validate availability JSONB schema)
- [ ] 9. Implement POST /profile/me/photo endpoint (multipart upload, validate format and size, resize, store in MinIO, update photo_storage_key, delete old photo if exists)
- [ ] 10. Implement DELETE /profile/me/photo endpoint (remove photo from MinIO, set photo_storage_key to NULL)
- [ ] 11. Implement GET /profile/:userId public profile endpoint (return only public fields via PublicProfileDTO, exclude email/phone/settings/exact coordinates, return work_zone_label instead of center point)
- [ ] 12. Implement portfolio service (upload photo to MinIO with user subfolder, validate max count from env, manage display_order, delete photo from MinIO + DB)
- [ ] 13. Implement POST /profile/me/portfolio and DELETE /profile/me/portfolio/:photoId endpoints (Cleaner role guard, max portfolio count validation, upload/delete with MinIO)
- [ ] 14. Implement profile completeness service (calculate percentage per role using configurable field weights from env, check profile_details + portfolio_photos + kyc_verifications + external aggregates)
- [ ] 15. Implement GET /profile/me/completeness endpoint (return percentage + breakdown of completed/incomplete fields per role)
- [ ] 16. Implement settings service (create default settings on user creation, update with validation — valid language codes, valid theme values, boolean notifications)
- [ ] 17. Implement GET /profile/me/settings and PATCH /profile/me/settings endpoints (get settings, update with validation, return updated settings)
- [ ] 18. Implement account service — change email (POST /profile/me/change-email — generate Keycloak email change URL, return URL for in-app browser, handle webhook/sync for email update in BidClean DB)
- [ ] 19. Implement account service — change password (POST /profile/me/change-password — generate Keycloak password change URL, return URL for in-app browser)
- [ ] 20. Implement account service — delete account (POST /profile/me/delete-account — validate confirmation word, check no active services, cascade: RevenueCat cancel → Keycloak delete → MinIO cleanup → DB soft-delete, compensating actions on partial failure)
- [ ] 21. Create mobile profile screens folder structure with README (screens, components, hooks, types, constants, tests)
- [ ] 22. Implement ProfileScreen (main profile view — conditionally renders HostProfileCard or CleanerProfileCard based on active role, includes ProfileHeader with completeness ring, RoleSwitchButton or AddSecondRoleButton)
- [ ] 23. Implement EditProfileScreen (form for personal data + role-specific fields, phone validation, specialties picker, work zone map selector, availability scheduler, save with optimistic updates)
- [ ] 24. Implement SettingsScreen (language selector with immediate i18n reload, theme toggle with immediate apply, notification preference toggles, sync to backend)
- [ ] 25. Implement AccountScreen (change email button → in-app browser, change password button → in-app browser, delete account button → DeleteAccountModal with confirmation input)
- [ ] 26. Implement PortfolioGalleryScreen (grid display of portfolio photos, upload button, reorder via drag, delete with confirmation, lazy loading with pagination)
- [ ] 27. Implement PublicProfileScreen (display public fields only, profile photo, name, ratings, specialties, portfolio gallery read-only, KYC badge, member since)
- [ ] 28. Create i18n translation files for profile module (en/profile.json, es/profile.json — all screen labels, error messages, settings options, confirmation dialogs)

## Task Dependency Graph

```json
{
  "waves": [
    [1, 2, 3, 4, 5, 21],
    [6, 16, 28],
    [7, 8, 9, 10, 11, 12, 14, 17, 22],
    [13, 15, 18, 19, 23, 24, 27],
    [20, 25, 26]
  ]
}
```

## Notes

- Profile details are stored in a separate table (not extending users) to maintain separation of concerns — the users table belongs to the auth module
- Profile photo uses the same MinIO encryption pattern as KYC documents but a different bucket (env: `MINIO_PROFILE_PHOTOS_BUCKET`)
- Email and password are NEVER stored in BidClean — all credential management is Keycloak's responsibility
- The profile completeness calculation reads from multiple tables/services (profile_details, portfolio_photos, kyc_verifications, Stripe, properties). It is computed on request, not cached.
- Field weights for completeness are configurable via environment variables as JSON objects
- Account deletion uses a compensating action pattern: if Keycloak deletion succeeds but MinIO cleanup fails, the failure is logged and retried via a background job
- The public profile endpoint uses a separate DTO (PublicProfileDTO) that structurally excludes private fields at the type level — this prevents accidental data leakage
- Work zone in public view shows only the `work_zone_label` (city/neighborhood name), never the exact `work_zone_center` coordinates
- Portfolio photos use lazy loading with cursor-based pagination for the gallery
- The RoleSwitchButton and AddSecondRoleButton components already exist from the user-roles spec — they are imported and rendered, not re-implemented
- Settings are stored both locally (Zustand + SecureStore for offline) and on the backend (for cross-device sync)
- All text in the profile screens uses i18n keys — no hardcoded UI strings
- Phone number validation uses E.164 format (with libphonenumber-js or similar)
- The availability JSONB field stores a structured schedule per day of week with enabled flag and time ranges
- Specialties are stored as a VARCHAR[] array; the list of valid specialty values is maintained as backend constants (not hardcoded in mobile)
- Ratings and completed services count are read-only aggregates — they come from the service-history module (not implemented here, just displayed)
- The delete account confirmation word is configurable via env (`PROFILE_DELETE_CONFIRMATION_WORD`) and localized
