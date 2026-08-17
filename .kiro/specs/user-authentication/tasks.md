# User Authentication — Tasks

## Infrastructure Tasks

- [ ] Task 1: Configure Keycloak realm for BidClean (realm, client, identity providers, password policy, email verification)
- [ ] Task 2: Add Keycloak environment variables to .env.example
- [ ] Task 3: Create database migration for users, auth_sessions, biometric_credentials, biometric_challenges tables

## Backend Tasks — Core Auth

- [ ] Task 4: Create auth module structure (module, controller, service, types, DTOs, README)
- [ ] Task 5: Implement Keycloak service (Admin API client for user creation, token validation config)
- [ ] Task 6: Implement JWT auth guard (validate Keycloak tokens via JWKS endpoint)
- [ ] Task 7: Implement register endpoint (validate DTO → create in Keycloak → create BidClean user)
- [ ] Task 8: Implement login URL endpoint (return Keycloak login page URL with redirect)
- [ ] Task 9: Implement callback endpoint (receive Keycloak tokens, create auth_session)
- [ ] Task 10: Implement /auth/me endpoint (return current user profile)

## Backend Tasks — Session Management

- [ ] Task 11: Implement session metadata service (create, track, remove by device)
- [ ] Task 12: Implement logout endpoint (revoke Keycloak session via Admin API + remove metadata)
- [ ] Task 13: Implement logout-all endpoint (revoke all Keycloak sessions + clear all metadata)

## Backend Tasks — Biometric

- [ ] Task 14: Implement biometric register endpoint (store public key per device)
- [ ] Task 15: Implement biometric challenge endpoint (generate nonce, 30s expiry, one-time use, device-bound)
- [ ] Task 16: Implement biometric verify endpoint (validate signature, establish Keycloak session, return tokens)
- [ ] Task 17: Implementation spike — validate Keycloak integration mechanism for passwordless biometric auth

## Backend Tasks — Rate Limiting & Security

- [ ] Task 18: Implement API rate limiting guard (Redis-backed, per IP, per endpoint type)
- [ ] Task 19: Configure Keycloak brute-force detection (thresholds, lockout, unlock flow)
- [ ] Task 20: Implement email verification status sync (Keycloak event listener or Admin API polling)

## Backend Tasks — Tests

- [ ] Task 21: Write unit tests for auth service (register, callback, session metadata)
- [ ] Task 22: Write unit tests for biometric service (challenge generation, signature verification)
- [ ] Task 23: Write unit tests for session metadata service (create, revoke, revoke-all)
- [ ] Task 24: Write integration tests for auth endpoints (full flow with test Keycloak)

## Frontend Tasks

- [ ] Task 25: Create auth screens folder structure with README
- [ ] Task 26: Implement Welcome screen (logo animation, Get Started / Log In buttons)
- [ ] Task 27: Implement Register screen (name, country, language fields + trigger Keycloak)
- [ ] Task 28: Implement OAuth flow with expo-auth-session (system browser, Authorization Code + PKCE, handle callback)
- [ ] Task 29: Implement Verify Email screen (status + resend button with cooldown)
- [ ] Task 30: Implement Biometric Setup screen (prompt + key pair generation + registration)
- [ ] Task 31: Create auth.store.ts (Zustand — user, tokens, session, biometric state)
- [ ] Task 32: Create api.service.ts (Axios client with JWKS token in Authorization header)
- [ ] Task 33: Implement token refresh (mobile refreshes directly with Keycloak token endpoint)
- [ ] Task 34: Implement secure token storage (expo-secure-store)
- [ ] Task 35: Implement biometric login flow (challenge → sign → verify → logged in)
- [ ] Task 36: Write component tests for auth screens
