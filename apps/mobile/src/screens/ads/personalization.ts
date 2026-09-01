/**
 * personalization — Pure derivation of the ad personalization mode from consent inputs.
 *
 * `personalizationMode` shapes eCPM, NOT eligibility (Req 4.3 / P6). It is derived from two
 * DISTINCT inputs that are never collapsed into a boolean: iOS App Tracking Transparency (ATT)
 * and Google UMP/GDPR consent. The derivation is PLATFORM-AWARE — ATT is iOS-only; on Android
 * ATT is `unavailable` and MUST NOT be read as a denial. The function is pure (no SDK) so it is
 * fully unit- and property-testable.
 */

import {
  PersonalizationMode,
  type AdPlatform,
  type ConsentState,
  type ConsentStatus,
  type TrackingAuthorizationStatus,
} from './ads.types';

// ─── UMP classification (shared across platforms) ─────────────────────────────

/** UMP permits personalized serving (consent obtained or not required by region). */
function umpPermits(status: ConsentStatus): boolean {
  return status === 'obtained' || status === 'not_required';
}

/** UMP explicitly withholds personalization (required by region but not yet obtained). */
function umpWithholds(status: ConsentStatus): boolean {
  return status === 'required';
}

// ─── ATT classification (iOS only) ─────────────────────────────────────────────

/** iOS ATT grants cross-app tracking. */
function attAuthorized(status: TrackingAuthorizationStatus): boolean {
  return status === 'authorized';
}

/** iOS ATT explicitly refuses cross-app tracking. */
function attDenies(status: TrackingAuthorizationStatus): boolean {
  return status === 'denied' || status === 'restricted';
}

// ─── Per-platform derivation ─────────────────────────────────────────────────

/**
 * iOS: consider BOTH ATT and UMP. Personalized only when ATT is authorized AND UMP permits. A
 * denial on either axis → non-personalized. Anything still pending → unresolved.
 */
function deriveIos(consent: ConsentState): PersonalizationMode {
  const { trackingAuthorizationStatus: att, consentStatus: ump } = consent;
  if (attDenies(att) || umpWithholds(ump)) {
    return PersonalizationMode.NON_PERSONALIZED;
  }
  if (attAuthorized(att) && umpPermits(ump)) {
    return PersonalizationMode.PERSONALIZED;
  }
  // ATT not_determined/unavailable or UMP unknown → not yet resolved.
  return PersonalizationMode.UNRESOLVED;
}

/**
 * Android: ATT does not apply (expected `unavailable`, never a denial). Decide from UMP only.
 */
function deriveAndroid(consent: ConsentState): PersonalizationMode {
  const ump = consent.consentStatus;
  if (umpWithholds(ump)) {
    return PersonalizationMode.NON_PERSONALIZED;
  }
  if (umpPermits(ump)) {
    return PersonalizationMode.PERSONALIZED;
  }
  return PersonalizationMode.UNRESOLVED;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Derive the personalization mode, platform-aware. Personalized only when the platform-relevant
 * inputs permit; UNRESOLVED until known; otherwise NON_PERSONALIZED. Consent never gates
 * eligibility — that is owned by `useAdVisibility` (`ad_free`).
 */
export function derivePersonalizationMode(
  platform: AdPlatform,
  consent: ConsentState,
): PersonalizationMode {
  return platform === 'ios' ? deriveIos(consent) : deriveAndroid(consent);
}
