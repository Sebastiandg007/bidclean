# Keycloak — BidClean Authentication

## Purpose

Keycloak is the single source of truth for identity, credentials, and OAuth flows in BidClean. This directory contains the realm configuration that is automatically imported when the Keycloak container starts for the first time.

## Files

| File | Responsibility |
|------|---------------|
| `realm-export.json` | Full realm configuration (client, identity providers, policies, flows) |

## Realm: `bidclean`

### Client: `bidclean-mobile`

Public OIDC client for the mobile app using Authorization Code + PKCE (S256).

| Setting | Value |
|---------|-------|
| Client ID | `bidclean-mobile` |
| Type | Public (no client secret) |
| Flow | Authorization Code + PKCE (S256) |
| Redirect URIs | `bidclean://callback`, `http://localhost:19006/*` |
| Web Origins | `+` (allow all registered redirect URIs) |
| Direct Access Grants | Disabled |

### Identity Providers

| Provider | Status | Notes |
|----------|--------|-------|
| Google | Enabled (placeholder) | Fill `clientId` and `clientSecret` with real Google OAuth credentials |
| Apple | Enabled (placeholder) | Fill `clientId` and `clientSecret` with real Apple Sign-In credentials |

Both providers use the **First Broker Login** flow for account linking — if a user signs in with Google and later with email using the same address, accounts are linked automatically.

### Password Policy

- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 digit
- At least 1 special character

### Brute-Force Detection

Keycloak provides native brute-force protection that detects rapid failed login attempts and progressively locks out the offending account. This protects user credentials from automated attacks without requiring external tooling.

#### Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| `bruteForceProtected` | `true` | Enables brute-force detection for the realm |
| `failureFactor` | `5` | Number of consecutive failed attempts before lockout triggers |
| `waitIncrementSeconds` | `60` | Each subsequent failure adds 60 seconds to the lockout |
| `minimumQuickLoginWaitSeconds` | `60` | Minimum lockout time for rapid-fire attempts |
| `maxFailureWaitSeconds` | `1800` | Maximum lockout duration cap (30 minutes) |
| `quickLoginCheckMilliSeconds` | `2000` | Attempts within 2 seconds of each other are flagged as rapid-fire |
| `maxDeltaTimeSeconds` | `43200` | Failure counter resets after 12 hours of no failures |
| `permanentLockout` | `false` | Account is never permanently locked (time-based auto-unlock) |

#### Progressive Lockout Behavior

The lockout duration increases progressively with each failed attempt after the threshold:

| Failed Attempts | Lockout Duration | Cumulative |
|-----------------|------------------|------------|
| 1–4 | No lockout | User can retry immediately |
| 5 (threshold) | 60 seconds | First lockout triggered |
| 6 | 120 seconds | Increment adds 60s |
| 7 | 180 seconds | Continues increasing |
| 8 | 240 seconds | ... |
| ... | +60s per failure | Up to max |
| N (where wait ≥ 1800s) | 1800 seconds (30 min) | Capped at maximum |

**Quick login detection:** If two login attempts arrive within 2000ms of each other (scripted attack pattern), the minimum lockout of 60 seconds is immediately applied regardless of failure count.

#### Unlock Flow

Accounts are unlocked through one of these mechanisms:

1. **Automatic time-based unlock (default):** After the lockout duration expires, the user can attempt login again. No action required from the user or admin.

2. **Failure counter reset:** If no failed attempts occur within 12 hours (`maxDeltaTimeSeconds`), the failure counter resets to zero. The user starts fresh.

3. **Admin manual unlock via Admin Console:**
   - Navigate to the Keycloak Admin Console → Users → select the locked user
   - Go to the "Sessions" or "Credentials" tab
   - Click "Unlock user" or clear the brute-force status
   - URL: `https://auth.bidclean.tech/admin/master/console/#/bidclean/users`

4. **Admin unlock via Admin API:**
   ```bash
   # Get admin token
   TOKEN=$(curl -s -X POST "https://auth.bidclean.tech/realms/master/protocol/openid-connect/token" \
     -d "client_id=admin-cli" \
     -d "username=admin" \
     -d "password=$KEYCLOAK_ADMIN_PASSWORD" \
     -d "grant_type=password" | jq -r '.access_token')

   # Clear brute-force status for a specific user
   curl -X DELETE "https://auth.bidclean.tech/admin/realms/bidclean/attack-detection/brute-force/users/{USER_ID}" \
     -H "Authorization: Bearer $TOKEN"

   # Clear brute-force status for ALL users in the realm
   curl -X DELETE "https://auth.bidclean.tech/admin/realms/bidclean/attack-detection/brute-force/users" \
     -H "Authorization: Bearer $TOKEN"
   ```

#### Design Rationale

- **5 failures threshold:** Balances security with usability — allows for genuine typos without immediate lockout.
- **Progressive lockout:** Deters automated attacks (each retry costs more time) while allowing legitimate users to recover quickly after a short wait.
- **No permanent lockout:** Avoids denial-of-service where an attacker intentionally locks out legitimate users. Time-based unlock ensures users always regain access.
- **30-minute cap:** Prevents excessive lockout while still making brute-force attacks impractical (an attacker would need hours between attempts).
- **12-hour reset window:** Ensures that occasional failed logins over days don't accumulate to trigger lockout.
- **2-second quick login check:** Detects scripted attacks that fire requests faster than a human can type.

#### Monitoring

Brute-force events can be monitored via:
- Keycloak Admin Console → Events → Login Events (filter by `LOGIN_ERROR`)
- Keycloak metrics endpoint (if Prometheus metrics are enabled)
- BidClean API logs when users report account lockout (HTTP 423 response)

#### Integration with BidClean API

When a user's account is temporarily locked by Keycloak, the login attempt returns an error. The BidClean API surfaces this as:

| HTTP Status | Error Code | Message |
|-------------|------------|---------|
| 423 | `ACCOUNT_LOCKED` | Account temporarily locked due to too many failed login attempts. Try again later. |

The mobile app displays a user-friendly message and a countdown timer (based on the lockout duration) before the user can retry.

### Token Lifespans

| Token | Lifespan |
|-------|----------|
| Access token | 15 minutes |
| Refresh token | Revoked on reuse (rotation enabled) |
| SSO session idle | 30 minutes |
| SSO session max | 10 hours |

### Email Verification

- Required action for all new users (`VERIFY_EMAIL` is a default action)
- Users cannot access full app features until email is verified
- SMTP server must be configured with real credentials for production

### Internationalization

Supported locales: `en`, `es`, `fr`, `de`, `it`, `pt`, `nl`

## How It Works

The realm is imported automatically on first startup via the `--import-realm` command flag in Docker Compose. Keycloak reads the JSON file from `/opt/keycloak/data/import/` on boot.

**Important:** The import only runs when the realm does not already exist. If you need to re-import, delete the existing `bidclean` realm from the Keycloak admin console first, or remove the Keycloak database data.

## Local Development

1. Start infrastructure: `docker compose up -d` (from `infra/`)
2. Access Keycloak admin: http://localhost:8080/admin
3. Login: `admin` / `admin_local` (or value of `KEYCLOAK_ADMIN_PASSWORD`)
4. The `bidclean` realm is available immediately

## Production Setup

Before deploying to production, configure:

1. **SMTP server** — Fill in `smtpServer` fields or configure via admin console
2. **Google OAuth** — Set real `clientId` and `clientSecret` for the Google identity provider
3. **Apple Sign-In** — Set real `clientId` and `clientSecret` for the Apple identity provider
4. **SSL** — Change `sslRequired` from `external` to `all` for strict TLS enforcement
5. **Domain** — Configure `auth.bidclean.tech` as the frontend URL in Keycloak settings

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `KEYCLOAK_ADMIN_PASSWORD` | Admin console password | Yes |
| `POSTGRES_PASSWORD` | Database password (shared with main DB) | Yes |
