# Auth Module

## Purpose

Handles user authentication and registration for BidClean. Manages Keycloak-delegated login flows, device-based biometric authentication, session tracking, and API protection. Keycloak is the single source of truth for identity and credentials — NestJS validates tokens and manages application-level session metadata.

## Files

| File | Responsibility |
|------|---------------|
| `auth.module.ts` | NestJS module definition, wires providers and controllers |
| `auth.controller.ts` | REST endpoints for register, login, logout, biometric, me |
| `auth.service.ts` | Orchestrates auth flows by coordinating sub-services |
| `auth.types.ts` | Shared type definitions (AuthTokens, AuthUser, etc.) |
| `keycloak/keycloak.service.ts` | Keycloak Admin API client (user creation, token exchange, session revocation) |
| `keycloak/keycloak.config.ts` | Keycloak connection configuration |
| `keycloak/email-verification-sync.service.ts` | Scheduled + on-demand email verification sync from Keycloak |
| `biometric/biometric.service.ts` | Biometric credential storage, challenge generation, signature verification |
| `biometric/biometric.types.ts` | Biometric credential and challenge interfaces |
| `session/session.service.ts` | Auth session metadata CRUD (device tracking, logout) |
| `session/session.types.ts` | Session metadata interfaces |
| `guards/jwt-auth.guard.ts` | JWT validation guard (Keycloak JWKS) |
| `guards/rate-limit.guard.ts` | Redis-backed rate limiting guard |
| `centrifugo/centrifugo.controller.ts` | `GET /auth/centrifugo/token` — mints connection tokens, and per-channel subscription tokens only after the chat participation check confirms the caller is a participant |
| `centrifugo/centrifugo-token.service.ts` | Signs Centrifugo connection + subscription tokens (HMAC-SHA256) for the authenticated subject's own user id |
| `dto/register.dto.ts` | Registration input validation |
| `dto/register-biometric.dto.ts` | Biometric registration input validation |
| `dto/biometric-verify.dto.ts` | Biometric verification input validation |

## Dependencies

- **Keycloak** — Identity provider, OAuth2/OIDC token issuer, user management
- **PostgreSQL** — Stores BidClean user profiles, auth sessions, biometric credentials
- **Redis** — Rate limiting counters, ephemeral data
- **Centrifugo** — WebSocket transport; auth signs its connection/subscription tokens (shared `CENTRIFUGO_TOKEN_SECRET`)
- **Chat module** — auth consults `ChatParticipationService.isParticipant()` before minting a per-channel subscription token; auth owns token issuance, chat owns participation

## API

| Method | Path | Description | Auth Required |
|--------|------|-------------|--------------|
| POST | `/auth/register` | Register new user (create in Keycloak + BidClean) | None |
| GET | `/auth/login-url` | Get Keycloak login page URL (with PKCE redirect) | None |
| POST | `/auth/callback` | Handle Keycloak token callback | None |
| POST | `/auth/refresh` | Refresh access token via Keycloak | Refresh token |
| POST | `/auth/logout` | Invalidate session on this device | Access token |
| POST | `/auth/logout-all` | Invalidate all sessions | Access token |
| POST | `/auth/biometric/register` | Store public key for device | Access token |
| POST | `/auth/biometric/challenge` | Generate nonce for biometric verify | Device ID |
| POST | `/auth/biometric/verify` | Verify biometric signature, issue tokens | Challenge + signature |
| GET | `/auth/me` | Get current user info | Access token |
| GET | `/auth/centrifugo/token` | Mint a Centrifugo connection token, or a per-channel subscription token when `?channel=chat:conversation:{id}` and the caller is a participant | Access token |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `KEYCLOAK_URL` | Keycloak base URL (e.g., `https://auth.bidclean.tech`) | Yes |
| `KEYCLOAK_REALM` | Keycloak realm name | Yes |
| `KEYCLOAK_CLIENT_ID` | OAuth2 client ID for BidClean mobile | Yes |
| `KEYCLOAK_CLIENT_SECRET` | OAuth2 client secret | Yes |
| `KEYCLOAK_ADMIN_CLIENT_ID` | Admin API client ID | Yes |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Admin API client secret | Yes |
| `REDIS_URL` | Redis connection URL for rate limiting | Yes |
| `KEYCLOAK_EMAIL_SYNC_INTERVAL_MS` | Polling interval for email verification sync (default: 30000) | No |
| `KEYCLOAK_EMAIL_SYNC_BATCH_SIZE` | Max users to check per sync cycle (default: 50) | No |

## Email Verification Sync

Keycloak is the source of truth for email verification. BidClean mirrors this status in `users.is_email_verified` for business logic (e.g., restricting unverified users from creating offers).

### How it works

1. **On login callback** — `auth.service.ts` syncs `emailVerified` from the Keycloak userinfo response.
2. **Scheduled polling** — `EmailVerificationSyncService` runs at a configurable interval (default 30s), queries unverified users from the DB, and checks each against the Keycloak Admin API.
3. **On-demand check** — When an unverified user hits `GET /auth/me`, the service performs a real-time check against Keycloak before returning the response.

This covers the gap where a user verifies their email (clicking the Keycloak link) while already logged in.
