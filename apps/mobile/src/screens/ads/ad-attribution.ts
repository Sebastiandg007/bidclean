/**
 * ad-attribution — Pure derivation of the privacy-scoped ad attribution identity.
 *
 * Ad revenue must attribute to the SAME user as subscriptions (for unified LTV), but this module
 * SHALL NOT hand BidClean's raw internal UUID to the ad network (Req 5.1 / 6.2 / P9). Instead it
 * derives a stable, re-derivable PSEUDONYM with purpose separation: a keyed SHA-256 digest over
 * `appUserId + PURPOSE`, salted by a configured attribution secret. This is deliberately NOT
 * anonymization — it is a purpose-separated pseudonym so the same user never accidentally shares
 * one identifier across contexts, and the raw id is never leaked.
 *
 * Uses `expo-crypto` (already a dependency, mocked in tests). Since Expo Crypto exposes a digest
 * (not a native HMAC), the derivation is a salted, purpose-separated digest — sufficient for a
 * non-reversible client-side pseudonym; it is not presented as a cryptographic MAC guarantee.
 */

import * as Crypto from 'expo-crypto';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Purpose tag ensuring the ad identifier is namespaced away from any other use of the UUID. */
const ATTRIBUTION_PURPOSE = ':ads';

/**
 * Configured attribution secret (salt). Client-safe: it only prevents trivial reversal of the
 * pseudonym on-device; it is never a server authorization secret. Empty when unconfigured.
 */
const AD_ATTRIBUTION_SECRET: string =
  process.env.EXPO_PUBLIC_AD_ATTRIBUTION_SECRET ?? '';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Derive the privacy-scoped pseudonymous attribution id passed to the ad network. Stable for a
 * given `appUserId` + configured secret, purpose-separated, and never the raw UUID. Returns a
 * hex digest string.
 */
export async function deriveAdAttributionId(appUserId: string): Promise<string> {
  const material = `${AD_ATTRIBUTION_SECRET}|${appUserId}${ATTRIBUTION_PURPOSE}`;
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, material);
}
