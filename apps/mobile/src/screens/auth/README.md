# Auth Screens

## Purpose

Authentication screens for BidClean mobile app. Handles the complete user authentication flow: welcome, registration, email verification, and biometric setup.

## Files

| File | Responsibility |
|------|---------------|
| `WelcomeScreen.tsx` | Landing screen with logo animation, Get Started and Log In buttons |
| `RegisterScreen.tsx` | Registration form: full name, country (ISO 3166-1), language (BCP 47) |
| `VerifyEmailScreen.tsx` | Email verification status display, resend button with 60s cooldown |
| `BiometricSetupScreen.tsx` | Biometric prompt, key pair generation, public key registration |
| `useOAuth.ts` | OAuth2 Authorization Code + PKCE hook (system browser login/register) |
| `oauth.config.ts` | OAuth configuration constants (Keycloak URLs, client ID, scopes) |
| `useAuth.ts` | Auth-specific hooks (navigation logic, session management) |
| `auth.types.ts` | TypeScript types for auth screens (props, navigation params, OAuth types) |

## Dependencies

- `expo-auth-session` — OAuth/OIDC Authorization Code + PKCE (system browser)
- `expo-web-browser` — System browser management for OAuth redirects
- `expo-local-authentication` — Biometric (fingerprint/Face ID)
- `expo-secure-store` — Encrypted token storage
- `expo-crypto` — PKCE code verifier/challenge generation, key pair generation
- `react-native-reanimated` — Spring physics animations (Welcome screen)
- `@bidclean/shared` — Shared types and constants

## Auth Flow (Screen Navigation)

```
WelcomeScreen
  ├── [Get Started] → RegisterScreen → VerifyEmailScreen → BiometricSetupScreen → Home
  └── [Log In] → System Browser (Keycloak) → Callback → BiometricSetupScreen → Home
```

## OAuth Flow (Authorization Code + PKCE)

The `useOAuth` hook manages the complete OAuth2 flow:

```
1. Generate PKCE code_verifier (random 32 bytes, base64url encoded)
2. Derive code_challenge = SHA-256(code_verifier), base64url encoded
3. Open system browser → Keycloak authorization endpoint
   - client_id, redirect_uri, response_type=code
   - code_challenge, code_challenge_method=S256
   - scopes: openid profile email offline_access
4. User authenticates (email/password or social login)
5. Keycloak redirects back → app receives authorization code
6. Send code + code_verifier to POST /auth/callback (BidClean API)
7. API exchanges code for tokens with Keycloak
8. API returns tokens + user info to mobile
```

### Login vs Registration

Both flows use the same OAuth mechanism. Registration adds `kc_action=register`
as an extra parameter, which tells Keycloak to show the registration form instead
of the login form.

### Error Handling

The hook returns structured errors with codes:
- `user_cancelled` — User closed the browser or pressed back
- `network_error` — Failed to reach Keycloak or BidClean API
- `invalid_code` — No authorization code in the redirect
- `token_exchange_failed` — API callback endpoint returned an error
- `unknown` — Unexpected failure

## Configuration

OAuth configuration lives in `oauth.config.ts`:
- **Keycloak Realm:** `bidclean`
- **Auth Domain:** `auth.bidclean.tech`
- **API Domain:** `api.bidclean.tech`
- **Client ID:** `bidclean-mobile`
- **App Scheme:** `bidclean` (for deep link redirects)

## Design System

- **Background:** `#0B0C10` (dark mode)
- **Card/containers:** `#1F2833`
- **Accent (CTAs):** `#00F5D4` (mint green)
- **Text:** `#FFFFFF`
- **Typography:** Space Grotesk / Cabinet Grotesk / Satoshi
- **Animations:** Reanimated 3, spring physics, shared element transitions

## Environment Variables

None directly — auth configuration is centralized in `oauth.config.ts`.
For production builds, these constants should be replaced by environment-specific values.
