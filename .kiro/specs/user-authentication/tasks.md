# Implementation Plan

## Overview

Implementation tasks for the User Authentication & Registration feature. Covers Keycloak configuration, NestJS backend auth module, and React Native/Expo mobile auth screens.

## Tasks

- [x] 1. Configure Keycloak realm for BidClean (realm, client, identity providers, password policy, email verification, brute-force detection)
- [x] 2. Add Keycloak environment variables to .env.example
- [x] 3. Create database migration for users, auth_sessions, biometric_credentials, biometric_challenges tables
- [x] 4. Create auth module structure (module, controller, service, types, DTOs, keycloak/, biometric/, session/, guards/, README)
- [x] 5. Implement Keycloak service (Admin API client for user creation, token exchange, session revocation)
- [x] 6. Implement JWT auth guard (validate Keycloak-issued JWTs via JWKS endpoint)
- [x] 7. Implement register endpoint (validate DTO, create user in Keycloak, create BidClean user in PostgreSQL)
- [x] 8. Implement login URL endpoint (return Keycloak authorization URL with PKCE parameters)
- [x] 9. Implement callback endpoint (exchange authorization code for tokens, create auth_session metadata)
- [x] 10. Implement /auth/me endpoint (return current user profile from BidClean database)
- [x] 11. Implement session metadata service (create, track, remove sessions by device, update last_active)
- [x] 12. Implement logout endpoint (revoke Keycloak session via Admin API, remove auth_session metadata)
- [x] 13. Implement logout-all endpoint (revoke all Keycloak sessions, clear all auth_session metadata)
- [x] 14. Implement biometric register endpoint (store device public key in biometric_credentials table)
- [x] 15. Implement biometric challenge endpoint (generate 32-byte nonce, 30s expiry, device-bound, one-time use)
- [x] 16. Implement biometric verify endpoint (validate challenge, verify signature, establish Keycloak session, return tokens)
- [x] 17. Implementation spike — validate Keycloak integration mechanism for passwordless biometric auth
- [x] 18. Implement API rate limiting guard (Redis-backed, per IP, configurable thresholds per endpoint type)
- [x] 19. Configure Keycloak brute-force detection (thresholds, progressive lockout, unlock flow)
- [x] 20. Implement email verification status sync (Keycloak event listener or Admin API polling)
- [x] 21. Write unit tests for auth service (register, callback, session metadata creation)
- [x] 22. Write unit tests for biometric service (challenge generation, signature verification, expiry)
- [x] 23. Write unit tests for session metadata service (create, revoke single, revoke-all)
- [ ] 24. Write integration tests for auth endpoints (full flow with test Keycloak)
- [x] 25. Create auth screens folder structure with README
- [x] 26. Implement Welcome screen (logo animation with Reanimated 3, Get Started and Log In buttons, dark theme)
- [x] 27. Implement Register screen (full name, country ISO 3166-1 picker, language BCP 47 picker)
- [x] 28. Implement OAuth flow with expo-auth-session (system browser, Authorization Code + PKCE, handle callback)
- [x] 29. Implement Verify Email screen (status display, resend button with 60-second cooldown timer)
- [x] 30. Implement Biometric Setup screen (prompt, key pair generation with expo-crypto, register public key via API)
- [x] 31. Create auth.store.ts (Zustand store for user, tokens, session, biometric state, login/logout/refresh actions)
- [x] 32. Create api.service.ts (Axios client with base URL, Authorization header from auth store, 401 interceptor)
- [x] 33. Implement token refresh (mobile refreshes directly with Keycloak token endpoint, updates SecureStore)
- [x] 34. Implement secure token storage (expo-secure-store for access_token and refresh_token persistence)
- [x] 35. Implement biometric login flow (request challenge, biometric prompt, sign with private key, verify via API)
- [x] 36. Write component tests for auth screens (Welcome, Register, VerifyEmail, BiometricSetup)

## Task Dependency Graph

```json
{
  "waves": [
    [1, 2, 3, 4, 25],
    [5, 11, 18, 19, 26, 27, 29, 31],
    [6, 7, 8, 9, 14, 15, 17, 20, 32, 34],
    [10, 12, 13, 16, 23, 28, 30, 33],
    [21, 22, 24, 35],
    [36]
  ]
}
```

## Notes

- Keycloak is the single source of truth for identity and credentials. NestJS never stores passwords or issues JWTs.
- Biometric data never leaves the device — only the public key is stored server-side.
- Task 17 (biometric spike) may affect Tasks 14-16 implementation details.
- Rate limiting (Task 18) requires Redis to be available.
- Mobile OAuth uses system browser (not WebView) for security.
- Integration tests (Task 24) require a test Keycloak instance.
