/**
 * Time-related constants used across the platform.
 */

/** Auto-release escrow payment if Host doesn't confirm (hours) */
export const ESCROW_AUTO_RELEASE_HOURS = 24;

/** Video verification temporary storage duration (hours) */
export const VIDEO_RETENTION_HOURS = 48;

/** Chat history retention (days) */
export const CHAT_RETENTION_DAYS = 90;

/** JWT access token expiration (minutes) */
export const ACCESS_TOKEN_EXPIRY_MINUTES = 15;

/** GPS tracking update interval during service (milliseconds) */
export const GPS_TRACKING_INTERVAL_MS = 3_000;

/** Cleaner location broadcast interval to Host (milliseconds) */
export const LOCATION_BROADCAST_INTERVAL_MS = 5_000;
