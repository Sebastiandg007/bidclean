/**
 * consent — Reads the two distinct consent inputs (iOS ATT + Google UMP) into a `ConsentState`.
 *
 * The two inputs are NEVER collapsed (Req 4.1). ATT is iOS-only; on Android it is reported as
 * `unavailable` (never a denial — the personalization derivation treats it as such). Both native
 * modules are loaded DEFENSIVELY so the app runs in dev/CI without a prebuild: a missing module
 * yields a safe "unresolved" input, so no personalized request is made until real consent exists
 * (Req 4.4 / P6). This module reads consent only; it never gates eligibility.
 */

import type {
  AdPlatform,
  ConsentState,
  ConsentStatus,
  TrackingAuthorizationStatus,
} from './ads.types';

// ─── iOS App Tracking Transparency ─────────────────────────────────────────────

interface TrackingTransparencyModule {
  getTrackingPermissionsAsync?: () => Promise<{ status: string }>;
  requestTrackingPermissionsAsync?: () => Promise<{ status: string }>;
}

/** Map the expo-tracking-transparency status string to our subset. */
function mapAttStatus(status: string): TrackingAuthorizationStatus {
  switch (status) {
    case 'granted':
      return 'authorized';
    case 'denied':
      return 'denied';
    case 'restricted':
      return 'restricted';
    case 'undetermined':
      return 'not_determined';
    default:
      return 'not_determined';
  }
}

/** Read iOS ATT status, requesting authorization once when still undetermined. */
async function readAttStatus(): Promise<TrackingAuthorizationStatus> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const att = require('expo-tracking-transparency') as TrackingTransparencyModule;
    const current = await att.getTrackingPermissionsAsync?.();
    if (current?.status === 'undetermined' && att.requestTrackingPermissionsAsync) {
      const requested = await att.requestTrackingPermissionsAsync();
      return mapAttStatus(requested.status);
    }
    return current ? mapAttStatus(current.status) : 'not_determined';
  } catch {
    return 'not_determined'; // SDK absent (dev/CI): unresolved, not a denial.
  }
}

// ─── Google UMP (GDPR/EEA) ──────────────────────────────────────────────────────

interface UmpModule {
  requestInfoUpdate?: () => Promise<void>;
  getConsentInfo?: () => Promise<{ status?: string }>;
}

/** Map the UMP consent status string to our subset. */
function mapUmpStatus(status: string | undefined): ConsentStatus {
  switch (status) {
    case 'OBTAINED':
      return 'obtained';
    case 'NOT_REQUIRED':
      return 'not_required';
    case 'REQUIRED':
      return 'required';
    default:
      return 'unknown';
  }
}

/** Read the UMP consent status (from react-native-google-mobile-ads' consent surface). */
async function readUmpStatus(): Promise<ConsentStatus> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ump = require('react-native-google-mobile-ads').AdsConsent as UmpModule;
    await ump.requestInfoUpdate?.();
    const info = await ump.getConsentInfo?.();
    return mapUmpStatus(info?.status);
  } catch {
    return 'unknown'; // SDK absent (dev/CI): unresolved.
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Read both consent inputs for the platform. ATT is queried only on iOS; on Android it is
 * `unavailable` (never a denial). UMP is queried on both platforms where applicable.
 */
export async function readConsentState(
  platform: AdPlatform,
): Promise<ConsentState> {
  const consentStatus = await readUmpStatus();
  const trackingAuthorizationStatus: TrackingAuthorizationStatus =
    platform === 'ios' ? await readAttStatus() : 'unavailable';
  return { trackingAuthorizationStatus, consentStatus };
}
