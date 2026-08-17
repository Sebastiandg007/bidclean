# User Authentication & Registration

## Overview

The authentication system for BidClean allows users to register, log in, and manage their session securely. Keycloak is the single source of truth for identity, credentials, and OAuth flows. The BidClean API stores only business-level user data and session metadata.

## Requirements

### REQ-1: User Registration
- Users can register with email + password (managed entirely by Keycloak)
- Users can register with Google OAuth (via Keycloak Identity Provider)
- Users can register with Apple Sign-In (via Keycloak Identity Provider)
- Registration requires: full name, email, country (ISO 3166-1 alpha-2), preferred language (BCP 47)
- Email verification is managed by Keycloak (sends verification email)
- User cannot access app features until email is verified (limited session)
- After registration, user must select role (Host or Cleaner) — handled in `user-roles` spec
- Account linking: if a user registers with Google and later with email using the same address, they are linked as one account (Keycloak First Broker Login flow)

### REQ-2: User Login
- Users can log in with email + password (credentials validated by Keycloak)
- Users can log in with Google OAuth (Keycloak handles the full OIDC flow)
- Users can log in with Apple Sign-In (Keycloak handles the full OIDC flow)
- Mobile opens Keycloak authorization endpoint using the system browser via Authorization Code Flow + PKCE
- Brute-force detection and account lockout are managed by Keycloak natively (configurable thresholds)
- NestJS provides API-level rate limiting (Redis-backed) for abuse protection
- Session maintained with Keycloak-issued JWT (access + refresh tokens)

### REQ-3: Biometric Authentication
- After first successful login, user is prompted to enable biometric (fingerprint/Face ID)
- Biometric data NEVER leaves the device — it unlocks a private key in Secure Enclave (iOS) / Keystore (Android)
- Flow requires server-generated challenge (nonce):
  1. Device requests challenge: `POST /auth/biometric/challenge`
  2. Server generates random nonce (one-time use, expires in 30 seconds, tied to device)
  3. Device uses biometric to unlock private key → signs the challenge
  4. Device sends signature: `POST /auth/biometric/verify`
  5. Server verifies signature against stored public key → issues new tokens
- Fallback to email/password if biometric fails or device changes

### REQ-4: Session Management
- Keycloak issues access tokens (short-lived, 15 min) and refresh tokens (7 days)
- Keycloak manages refresh token rotation and revocation (configured with refresh token revocation protection)
- NestJS validates Keycloak tokens using JWKS (JSON Web Key Set) endpoint
- BidClean stores session metadata in `auth_sessions` for device tracking and application-level logout
- BidClean does NOT mint or replace Keycloak refresh tokens
- User can be logged in on multiple devices simultaneously
- Logout revokes the corresponding Keycloak user session/token
- "Logout all devices" revokes all active Keycloak sessions for the user

### REQ-5: Password Management
- All password operations are handled by Keycloak (hashing, storage, validation, reset)
- Password policy configured in Keycloak: minimum 8 characters, at least 1 uppercase, 1 number, 1 special character
- Forgot password: Keycloak sends reset email with time-limited link
- Password reset: user sets new password via Keycloak's flow
- Sensitive operations (change email) require re-authentication through Keycloak

### REQ-6: Email Verification
- Managed by Keycloak (sends verification code/link)
- Verification code expires in 15 minutes
- Maximum 3 attempts per code (then must request new code)
- Resend cooldown: 60 seconds between resend requests
- Previous code is invalidated when new one is generated
- User gets limited session until verified (can see app but cannot create offers or accept services)

### REQ-7: Security
- API-level rate limiting (NestJS + Redis) protects against abuse and DDoS
- Credential brute-force detection and account lockout managed by Keycloak natively
- Passwords securely hashed by Keycloak using its configured policy (Argon2 or bcrypt)
- JWT tokens signed by Keycloak with RS256 (verified via JWKS)
- Biometric challenges: random, one-time, 30s expiry, device-bound
- No sensitive data (passwords, biometric data, private keys) ever stored in BidClean's database

### REQ-8: Social Login & Account Linking
- Google and Apple OAuth flows are handled entirely by Keycloak Identity Providers
- Mobile opens Keycloak authorization endpoint using the system browser via Authorization Code Flow + PKCE
- NestJS never receives Google/Apple tokens directly
- Google and Apple identities are linked through Keycloak's Identity Brokering / First Broker Login flow
- Automatic account linking is allowed only when the configured provider identity and verified email satisfy the account-linking policy
- BidClean does not perform email-based account merging itself
- Apple Hide My Email: handled per Keycloak's configured linking policy

## Explicitly Out of Scope
- Role selection (Host/Cleaner) → `user-roles` spec
- KYC verification → `kyc-verification` spec
- Profile details (photo, bio, etc.) → `user-profile` spec
- MFA / 2FA → Out of scope for v1. Biometric is device-local auth, not server-side MFA. Keycloak supports TOTP/WebAuthn if needed in future.
