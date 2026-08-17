# User Authentication — Technical Design

## Architecture

```
Mobile App (Expo)
    ↓ (HTTPS)
Keycloak (Identity Provider — OAuth2/OIDC)
    ↕ (OAuth flows: Google, Apple)
    ↓ (Tokens issued)
Mobile App
    ↓ (JWT in Authorization header)
NestJS API (validates JWT via JWKS, manages sessions + biometric)
    ↓
PostgreSQL (BidClean user data, sessions, biometric credentials)
```

**Key architectural decision:** Keycloak is the token issuer. NestJS never issues its own JWTs — it validates Keycloak tokens using the JWKS endpoint. This eliminates the complexity of maintaining a separate token layer.

## Responsibility Matrix

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

## Auth Flow Diagrams

### Registration Flow
```
Mobile
│
│ POST /auth/register (fullName, email, country, language)
▼
NestJS API
│
├── Validate DTO (format, country ISO 3166-1, language BCP 47)
│
▼
Keycloak Admin API
│
├── Create user identity
├── Set password (if email registration)
├── Send verification email
│
▼
PostgreSQL
│
└── Create BidClean user record (keycloak_id, full_name, country, language)
│
▼
Mobile
│
└── "Check your email to verify your account"
```

### Login Flow (Email/Password)
```
Mobile
│
│ Opens Keycloak authorization endpoint (system browser, PKCE)
▼
Keycloak
│
├── Validates credentials
├── Brute-force detection (native)
├── Issues access_token + refresh_token (signed RS256)
│
▼
Mobile
│
├── Receives tokens via redirect (Authorization Code + PKCE)
├── Stores tokens in SecureStore
├── Sends access_token to NestJS API
│
▼
NestJS API
│
├── Validates JWT via JWKS endpoint
├── Creates/updates auth_session metadata (device tracking)
├── Returns user profile data
│
▼
Mobile
│
└── User is logged in
```

### Social Login Flow (Google/Apple)
```
Mobile
│
│ Opens Keycloak authorization endpoint (system browser, PKCE)
▼
Keycloak
│
├── Shows Google/Apple button
├── Redirects to provider (OAuth2 Authorization Code + PKCE)
│
▼
Google / Apple
│
├── User authenticates
├── Returns authorization code to Keycloak
│
▼
Keycloak
│
├── Exchanges code for user info
├── Identity Brokering / First Broker Login (linking per configured policy)
├── Issues access_token + refresh_token
│
▼
Mobile
│
├── Receives tokens via redirect
├── Stores in SecureStore
│
▼
NestJS API
│
├── Validates JWT, creates BidClean user if first time
├── Creates auth_session metadata
│
▼
Mobile
│
└── User is logged in
```

### Biometric Authentication Flow
```
Mobile
│
│ App opens → biometric prompt
▼
Device Secure Enclave / Keystore
│
├── Biometric verification (local only — data never leaves device)
├── Private key unlocked
│
▼
Mobile
│
│ POST /auth/biometric/challenge { deviceId }
▼
NestJS API
│
├── Generate random nonce (32 bytes, cryptographically secure)
├── Store: { nonce, deviceId, expiresAt: now + 30s, used: false }
├── Return: { challenge: nonce, expiresAt }
│
▼
Mobile
│
├── Sign challenge with private key
│ POST /auth/biometric/verify { deviceId, signature, challenge }
▼
NestJS API
│
├── Find stored challenge (not expired, not used, matches deviceId)
├── Retrieve public key from biometric_credentials (by deviceId)
├── Verify signature against public key
├── Mark challenge as used
├── Establish authenticated Keycloak user session (implementation spike required)
├── Create/update auth_session metadata
├── Return: { accessToken, refreshToken } (Keycloak-issued)
│
▼
Mobile
│
└── User is logged in (seamless, no typing)
```

> **Implementation Note:** Biometric authentication is a custom passwordless mechanism.
> The exact Keycloak integration (custom authentication flow, token exchange, or
> another supported mechanism) must be validated as part of an implementation spike
> before production. The mechanism must establish an authenticated Keycloak user
> session without exposing the user's password to BidClean.

### Refresh Token Management
```
Keycloak manages refresh token rotation and revocation natively.
BidClean does NOT mint or replace refresh tokens.

Normal refresh:
  Mobile sends refresh_token to Keycloak token endpoint
  → Keycloak validates and rotates token
  → Keycloak returns new access_token + refresh_token
  → Mobile updates SecureStore
  → Mobile notifies NestJS of session activity (optional heartbeat)

Logout (single device):
  Mobile calls POST /auth/logout
  → NestJS revokes Keycloak session via Admin API
  → NestJS removes auth_session metadata record
  → Mobile clears SecureStore

Logout all devices:
  Mobile calls POST /auth/logout-all
  → NestJS revokes all Keycloak sessions for user via Admin API
  → NestJS removes all auth_session metadata records
  → Mobile clears SecureStore
```

## API Endpoints

| Method | Path | Description | Auth Required |
|--------|------|-------------|--------------|
| POST | `/auth/register` | Register new user (create in Keycloak + BidClean) | None |
| GET | `/auth/login-url` | Get Keycloak login page URL (with redirect) | None |
| POST | `/auth/callback` | Handle Keycloak token callback | None |
| POST | `/auth/refresh` | Refresh access token (rotation) | Refresh token |
| POST | `/auth/logout` | Invalidate session on this device | Access token |
| POST | `/auth/logout-all` | Invalidate all sessions | Access token |
| POST | `/auth/biometric/register` | Store public key for device | Access token |
| POST | `/auth/biometric/challenge` | Generate nonce for biometric verify | Device ID |
| POST | `/auth/biometric/verify` | Verify biometric signature, issue tokens | Challenge + signature |
| GET | `/auth/me` | Get current user info | Access token |

## Database Schema

```sql
-- BidClean user (business-level data only, not credentials)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keycloak_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    country CHAR(2) NOT NULL,                    -- ISO 3166-1 alpha-2
    language VARCHAR(35) NOT NULL DEFAULT 'en',  -- BCP 47
    is_email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_keycloak_id ON users(keycloak_id);

-- Session metadata (for device tracking and app-level logout)
-- Note: Keycloak manages actual token lifecycle and rotation
CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    keycloak_session_id VARCHAR(255),            -- Maps to Keycloak session for revocation
    device_id VARCHAR(255) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX idx_sessions_device_id ON auth_sessions(device_id);
CREATE INDEX idx_sessions_keycloak ON auth_sessions(keycloak_session_id);

-- Biometric credentials (per device)
CREATE TABLE biometric_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(255) NOT NULL,
    public_key TEXT NOT NULL,
    credential_type VARCHAR(50) NOT NULL,        -- 'fingerprint' | 'face_id'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, device_id)
);

CREATE INDEX idx_biometric_user_device ON biometric_credentials(user_id, device_id);

-- Biometric challenges (short-lived, can also use Redis with TTL)
CREATE TABLE biometric_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(255) NOT NULL,
    nonce VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_challenges_device ON biometric_challenges(device_id);
```

## Rate Limiting & Brute-Force Protection

### Keycloak (credential-level protection):
- Brute-force detection: configurable thresholds
- Account lockout after N failed attempts
- Account unlock via email or admin
- Wait time between failed attempts (progressive)

### NestJS + Redis (API-level abuse protection):

| Scope | Threshold | Action | Reset |
|-------|-----------|--------|-------|
| Per IP (any endpoint) | 100 req/min | Block IP for 5 min | Time-based |
| Per IP (auth endpoints) | 20 req/min | Block IP for 15 min | Time-based |
| Per IP (register) | 3 attempts / hour | Block IP for 1 hour | Time-based |
| Per IP (biometric challenge) | 10 / minute | Block for 5 min | Time-based |
| Per user (resend verification) | 1 / 60 seconds | Reject request | Time-based |

## Mobile Screens

| Screen | Route | Description |
|--------|-------|-------------|
| Welcome | `/` | Logo + "Get Started" / "Log In" buttons |
| Keycloak Login | External browser/webview | Keycloak-managed login page (email, social) |
| Register | `/auth/register` | Name, country, language (minimal — email/password via Keycloak) |
| Verify Email | `/auth/verify-email` | "Check your email" status + resend button |
| Biometric Setup | `/auth/biometric-setup` | "Enable fingerprint/Face ID?" prompt |

## Dependencies

### Backend
- `keycloak-admin-client` — Keycloak Admin API for user creation
- `jwks-rsa` — JWKS token validation
- `@nestjs/passport` + `passport-jwt` — JWT auth guard
- `rate-limiter-flexible` — Rate limiting (Redis-backed)

### Mobile
- `expo-auth-session` — OAuth/OIDC Authorization Code + PKCE flow (system browser)
- `expo-local-authentication` — Biometric (fingerprint/Face ID)
- `expo-secure-store` — Encrypted token storage
- `expo-crypto` — Key pair generation for biometric

## File Structure (API)

```
services/api/src/auth/
├── auth.module.ts
├── auth.controller.ts
├── auth.service.ts
├── auth.types.ts
├── keycloak/
│   ├── keycloak.service.ts       (Keycloak Admin API interactions)
│   └── keycloak.config.ts        (realm, client config)
├── biometric/
│   ├── biometric.service.ts      (challenge generation, verification)
│   └── biometric.types.ts
├── session/
│   ├── session.service.ts        (create, revoke, rotate tokens)
│   └── session.types.ts
├── guards/
│   ├── jwt-auth.guard.ts         (validates Keycloak JWT via JWKS)
│   └── rate-limit.guard.ts       (progressive rate limiting)
├── dto/
│   ├── register.dto.ts
│   └── biometric-verify.dto.ts
├── __tests__/
│   ├── auth.service.spec.ts
│   ├── biometric.service.spec.ts
│   └── session.service.spec.ts
└── README.md
```

## File Structure (Mobile)

```
apps/mobile/src/screens/auth/
├── WelcomeScreen.tsx
├── RegisterScreen.tsx
├── VerifyEmailScreen.tsx
├── BiometricSetupScreen.tsx
├── useAuth.ts                    (hook: login, register, biometric, logout)
├── auth.types.ts
└── README.md
```
