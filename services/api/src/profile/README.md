# Profile Module

## Purpose

Manages user profile data, photos, portfolio, settings, profile completeness calculation, account operations (email/password via Keycloak, async deletion), and Keycloak email webhook synchronization. Supports split PATCH endpoints for role-specific data separation (common, host, cleaner).

## Files

| File | Responsibility |
|------|---------------|
| `profile.module.ts` | NestJS module registration (entities, providers, queue) |
| `profile.controller.ts` | REST endpoints for profile CRUD, photos, portfolio, settings, account |
| `profile.service.ts` | Core profile orchestration (get/update profiles) |
| `profile.types.ts` | TypeScript interfaces and types for the module |
| `profile.repository.ts` | Database queries including dedicated public profile SELECT |

### Submodules

| Folder | Responsibility |
|--------|---------------|
| `photo/` | Profile photo upload (resize via sharp, AES-256 encryption), deletion, signed URL generation (MinIO) |
| `portfolio/` | Portfolio photo management for Cleaner users |
| `settings/` | User preferences (language, theme, notifications) |
| `account/` | Email/password change URLs, account deletion (async via BullMQ) |
| `completeness/` | Profile completion calculation with configurable weights |
| `webhooks/` | Keycloak Event Listener webhook for email sync |
| `dto/` | Request/response validation DTOs with class-validator |
| `entities/` | TypeORM entities (profile_details, user_settings, portfolio_photos) |
| `__tests__/` | Unit test files for all services |

## Dependencies

- **TypeORM** — database access for profile_details, user_settings, portfolio_photos
- **BullMQ** — async account deletion queue
- **ConfigModule** — environment variable access
- **MinIO** — object storage for photos (via env configuration)
- **sharp** — image resizing (fit within max dimension, maintaining aspect ratio)
- **Keycloak** — credential management delegation and webhook events
- **user-roles module** — reads/writes host_profiles and cleaner_profiles tables (not owned)
- **kyc-verification module** — reads KYC status for completeness (read-only)

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/profile/me` | Get own full private profile |
| PATCH | `/profile/me` | Update common fields (display_name, phone) |
| PATCH | `/profile/me/host` | Update host-specific fields (Host role required) |
| PATCH | `/profile/me/cleaner` | Update cleaner-specific fields (Cleaner role required) |
| POST | `/profile/me/photo` | Upload profile photo |
| DELETE | `/profile/me/photo` | Remove profile photo |
| GET | `/profile/me/completeness` | Get profile completeness percentage |
| GET | `/profile/:userId` | Get public profile (dedicated SELECT) |
| POST | `/profile/me/portfolio` | Upload portfolio photo (Cleaner only) |
| DELETE | `/profile/me/portfolio/:photoId` | Remove portfolio photo |
| GET | `/profile/me/settings` | Get user settings |
| PATCH | `/profile/me/settings` | Update user settings |
| POST | `/profile/me/change-email` | Get Keycloak email change URL |
| POST | `/profile/me/change-password` | Get Keycloak password change URL |
| POST | `/profile/me/delete-account` | Request account deletion (async) |
| POST | `/webhooks/keycloak/email` | Keycloak email sync webhook |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MINIO_PROFILE_PHOTOS_BUCKET` | MinIO bucket name for profile/portfolio photos | Yes |
| `PROFILE_PHOTO_MAX_SIZE_MB` | Maximum photo file size in MB | Yes |
| `PROFILE_PHOTO_MAX_DIMENSION_PX` | Maximum photo dimension in pixels | Yes |
| `PROFILE_PHOTO_URL_EXPIRY_SECONDS` | Signed URL expiry duration | Yes |
| `PROFILE_MAX_PORTFOLIO_PHOTOS` | Maximum number of portfolio photos | Yes |
| `PROFILE_UPLOAD_TIMEOUT_MS` | Photo upload timeout in milliseconds | Yes |
| `PROFILE_RATE_LIMIT_PER_MINUTE` | Rate limit for profile endpoints | Yes |
| `PROFILE_NAME_MAX_LENGTH` | Maximum display name length | Yes |
| `PROFILE_BIO_MAX_LENGTH` | Maximum bio length | Yes |
| `PROFILE_DELETE_CONFIRMATION_WORD` | Word user must type to confirm deletion | Yes |
| `PROFILE_DELETION_MAX_RETRIES` | Max retries for deletion job | Yes |
| `PROFILE_COMPLETENESS_WEIGHTS_HOST` | JSON object with host field weights (must sum to 100) | Yes |
| `PROFILE_COMPLETENESS_WEIGHTS_CLEANER` | JSON object with cleaner field weights (must sum to 100) | Yes |
| `KEYCLOAK_WEBHOOK_SECRET` | Shared secret for Keycloak webhook validation | Yes |

## Architecture Notes

- Profile details stored in separate table (not extending users) for separation of concerns
- Role-specific fields live in `host_profiles` and `cleaner_profiles` (owned by user-roles spec)
- Email/password NEVER stored in BidClean — Keycloak is the source of truth
- `users.email` is a denormalized cache updated via webhook
- Account deletion is fully async: request → mark DELETION_PENDING → enqueue BullMQ job
- Public profile uses dedicated SELECT query (never SELECT * and filter)
- Profile completeness validates weight sums on boot (fail-fast)
- Portfolio completeness derived from COUNT(*) — never a stored boolean
