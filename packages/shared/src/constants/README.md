# Constants

## Purpose

Default business and time values shared by the API and the mobile app. They are defaults: production values can be overridden through environment variables where a service supports it.

## Files

| File | Responsibility |
|------|---------------|
| `index.ts` | Re-exports both constants files. |
| `business.constants.ts` | Commission percentages (`HOST_COMMISSION_PERCENT` 0.10, `CLEANER_COMMISSION_PERCENT` 0.03, `TOTAL_COMMISSION_PERCENT`), radar radius (`INITIAL_SEARCH_RADIUS_KM`, `MAX_SEARCH_RADIUS_KM`, `RADIUS_EXPANSION_STEP_KM`, `RADIUS_EXPANSION_INTERVAL_MS`), `PRO_ADVANTAGE_DELAY_MS`, `OFFER_DECISION_TIMEOUT_MS`, `ARRIVAL_GEOFENCE_RADIUS_M`, `FREE_CANCELLATION_LIMIT`, `MIN_OFFER_PRICE_USD`. |
| `time.constants.ts` | `ESCROW_AUTO_RELEASE_HOURS`, `VIDEO_RETENTION_HOURS`, `CHAT_RETENTION_DAYS`, `ACCESS_TOKEN_EXPIRY_MINUTES`, `GPS_TRACKING_INTERVAL_MS`, `LOCATION_BROADCAST_INTERVAL_MS`. |

## Dependencies

- None.
