# Design Document

## Overview

The authentication system uses Keycloak as the single source of truth for identity, credentials, and OAuth flows. NestJS validates Keycloak-issued JWTs via JWKS and manages session metadata for device tracking. The mobile app uses system browser with Authorization Code + PKCE for all login flows.

### Responsibility Matrix

| Responsibility | Keycloak | BidClean API (NestJS) |
|----------------|----------|----------------------|
| Password storage & hashing | ✅ | ❌ |
| Google OAuth flow | ✅ | ❌ |
| Apple Sign-In flow | ✅ | ❌ |
| Email verification | ✅ | metadata sync |
| Password reset | ✅ | orchestration trigger |
| JWT issuance | ✅ | ❌ (validates only) |
| Identity (canonical) | ✅ | reference via `keycloak_id` |
| BidClean user profile | ❌ | ✅ |
| Session tracking (devices) | ❌ | ✅ |
| Biometric credentials | ❌ | ✅ |
| Rate limiting | basic (brute-force) | ✅ (API abuse protection, Redis) |
| Account linking | ✅ (First Broker Login, configurable policy) | ❌ |
| Refresh token rotation | ✅ (native configuration) | ❌ (does not mint/replace tokens) |
| Business authorization | ❌ | ✅ |

## Architecture

The system follows a three-layer architecture: Mobile App → NestJS API → Keycloak. Keycloak is the token issuer, NestJS validates and tracks sessions, the mobile app uses system browser for all OAuth flows.

```
Mobile App (Expo) → System Browser → Keycloak (OAuth2/OIDC)
Mobile App → NestJS API (validates JWT via JWKS, manages sessions + biometric)
NestJS API → PostgreSQL (BidClean user data, sessions, biometric credentials)
```

## Components and Interfaces

### API Endpoints

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

### Component Structure

```
services/api/src/auth/
├── auth.module.ts
├── auth.controller.ts
├── auth.service.ts
├── auth.types.ts
├── keycloak/
│   ├── keycloak.service.ts
│   └── keycloak.config.ts
├── biometric/
│   ├── biometric.service.ts
│   └── biometric.types.ts
├── session/
│   ├── session.service.ts
│   └── session.types.ts
├── guards/
│   ├── jwt-auth.guard.ts
│   └── rate-limit.guard.ts
├── dto/
│   ├── register.dto.ts
│   └── biometric-verify.dto.ts
├── __tests__/
│   ├── auth.service.spec.ts
│   ├── biometric.service.spec.ts
│   └── session.service.spec.ts
└── README.md
```

### Mobile Screen Structure

```
apps/mobile/src/screens/auth/
├── WelcomeScreen.tsx
├── RegisterScreen.tsx
├── VerifyEmailScreen.tsx
├── BiometricSetupScreen.tsx
├── useAuth.ts
├── auth.types.ts
└── README.md
```

## Data Models

### Users Table

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keycloak_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    country CHAR(2) NOT NULL,
    language VARCHAR(35) NOT NULL DEFAULT 'en',
    is_email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Auth Sessions Table

```sql
CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    keycloak_session_id VARCHAR(255),
    device_id VARCHAR(255) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Biometric Credentials Table

```sql
CREATE TABLE biometric_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(255) NOT NULL,
    public_key TEXT NOT NULL,
    credential_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, device_id)
);
```

### Biometric Challenges Table

```sql
CREATE TABLE biometric_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(255) NOT NULL,
    nonce VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Auth Flows

### Registration Flow

1. Mobile sends POST /auth/register (fullName, email, country, language)
2. NestJS validates DTO (format, ISO 3166-1, BCP 47)
3. NestJS creates user in Keycloak via Admin API
4. NestJS creates BidClean user record in PostgreSQL
5. Keycloak sends verification email
6. Mobile shows "Check your email" screen

### Login Flow (System Browser + PKCE)

1. Mobile requests GET /auth/login-url
2. NestJS returns Keycloak authorization URL with PKCE params
3. Mobile opens system browser to Keycloak login page
4. User authenticates (email/password or social)
5. Keycloak issues tokens, redirects back to app
6. Mobile sends POST /auth/callback with authorization code
7. NestJS exchanges code for tokens via Keycloak
8. NestJS creates auth_session metadata
9. Mobile stores tokens in SecureStore

### Biometric Flow

1. Mobile requests POST /auth/biometric/challenge with deviceId
2. NestJS generates 32-byte nonce, stores with 30s expiry
3. Mobile prompts biometric → unlocks private key in Secure Enclave
4. Mobile signs challenge with private key
5. Mobile sends POST /auth/biometric/verify with signature
6. NestJS verifies signature against stored public key
7. NestJS establishes Keycloak session (mechanism validated in spike)
8. NestJS returns tokens to mobile

### Refresh Token Management

- Mobile refreshes directly with Keycloak token endpoint
- Keycloak handles rotation and revocation natively
- BidClean does NOT mint or replace tokens

### Logout

- Single device: NestJS revokes Keycloak session via Admin API + removes auth_session
- All devices: NestJS revokes all Keycloak sessions + clears all auth_sessions

## Error Handling

| Error Case | HTTP Status | Response |
|-----------|-------------|----------|
| Invalid registration data | 400 | Validation error details |
| Email already registered | 409 | Conflict with existing account |
| Invalid credentials | 401 | Authentication failed |
| Token expired | 401 | Token expired, refresh required |
| Rate limit exceeded | 429 | Too many requests, retry after X |
| Biometric challenge expired | 410 | Challenge expired, request new one |
| Biometric signature invalid | 401 | Signature verification failed |
| Account locked | 423 | Account locked, check email for unlock |

## Testing Strategy

### Unit Tests
- Auth service: register flow, callback exchange, session creation
- Biometric service: challenge generation, signature verification, expiry handling
- Session service: create, revoke, revoke-all operations

### Integration Tests
- Full auth flow with test Keycloak instance: register → login → callback → me → logout

### Property-Based Tests (fast-check)
- Nonce generation always produces unique values
- Challenge expiry is always in the future
- Token validation rejects all malformed tokens

## Correctness Properties

### Property 1: Unique Email
A user can only have one account per email address.

### Property 2: Device-Bound Biometric
Biometric credentials are bound to exactly one device per user.

### Property 3: Single-Use Challenge
Challenges are single-use and expire after 30 seconds.

### Property 4: Complete Logout
Logout always revokes the Keycloak session (not just local state).

### Property 5: Session Cleanup
Session metadata is always cleaned up on logout.

### Property 6: No Sensitive Storage
No sensitive data (passwords, private keys) is ever stored in BidClean's database.

## Dependencies

### Backend
- `keycloak-admin-client` — Keycloak Admin API
- `jwks-rsa` — JWKS token validation
- `@nestjs/passport` + `passport-jwt` — JWT auth guard
- `rate-limiter-flexible` — Redis-backed rate limiting

### Mobile
- `expo-auth-session` — OAuth/OIDC Authorization Code + PKCE (system browser)
- `expo-local-authentication` — Biometric (fingerprint/Face ID)
- `expo-secure-store` — Encrypted token storage
- `expo-crypto` — Key pair generation for biometric
