import {
  OFFER_HOST_FEE_RATE_BPS,
  OFFER_CLEANER_RATE_BPS,
} from '../offers/offers.constants';
import { RateSide } from './commission.types';

/**
 * Commission-system constants.
 *
 * All configurable values derive from environment variables with sensible defaults.
 * The DEFAULT commission rates are re-exported from `offers.constants` so the fallback
 * value can NEVER diverge between offer-publishing and commission-system (single source
 * of truth). Business-rule values are NEVER hardcoded in logic.
 */

// Re-export the shared default rate constants (single source of truth).
export { OFFER_HOST_FEE_RATE_BPS, OFFER_CLEANER_RATE_BPS };

/** Technical basis-points bound: 10000 bps = 100%. */
export const BPS_MAX = 10000;

/** In-memory ruleset cache refresh interval (ms, default 60s). */
export const COMMISSION_RULES_CACHE_TTL_MS = parseInt(
  process.env.COMMISSION_RULES_CACHE_TTL_MS ?? '60000',
  10,
);

/** Bound on the subscriber-tier lookup before degrading to FREE (ms, default 500). */
export const COMMISSION_TIER_LOOKUP_TIMEOUT_MS = parseInt(
  process.env.COMMISSION_TIER_LOOKUP_TIMEOUT_MS ?? '500',
  10,
);

/** Rate limit for admin commission-rule endpoints (requests/min, default 30). */
export const COMMISSION_ADMIN_RATE_LIMIT_PER_MINUTE = parseInt(
  process.env.COMMISSION_ADMIN_RATE_LIMIT_PER_MINUTE ?? '30',
  10,
);

/** Business-policy cap on the Host fee rate (bps, default 5000 = 50%). */
export const COMMISSION_MAX_HOST_RATE_BPS = parseInt(
  process.env.COMMISSION_MAX_HOST_RATE_BPS ?? '5000',
  10,
);

/** Business-policy cap on the Cleaner commission rate (bps, default 5000 = 50%). */
export const COMMISSION_MAX_CLEANER_RATE_BPS = parseInt(
  process.env.COMMISSION_MAX_CLEANER_RATE_BPS ?? '5000',
  10,
);

/** Redis pub/sub channel for cross-instance ruleset cache invalidation. */
export const COMMISSION_CACHE_INVALIDATION_CHANNEL =
  process.env.COMMISSION_CACHE_INVALIDATION_CHANNEL ?? 'commission:rules:invalidate';

/** ISO 3166-1 alpha-2 country codes the platform supports (mirrors properties CHECK). */
export const SUPPORTED_COUNTRIES: readonly string[] = [
  'CO', 'US', 'CA', 'GB', 'DE', 'FR', 'IT', 'ES', 'PT', 'NL',
] as const;

/** Default env-backed rate (bps) for a given rate side — the fallback source of truth. */
export function defaultRateBpsForSide(side: RateSide): number {
  return side === RateSide.HOST ? OFFER_HOST_FEE_RATE_BPS : OFFER_CLEANER_RATE_BPS;
}

/** Business-policy cap (bps) for a given rate side. */
export function maxRateBpsForSide(side: RateSide): number {
  return side === RateSide.HOST
    ? COMMISSION_MAX_HOST_RATE_BPS
    : COMMISSION_MAX_CLEANER_RATE_BPS;
}

/**
 * Fail-fast startup validation for all commission configuration.
 * Throws on the first invalid value so a misconfigured deployment never boots.
 */
export function validateCommissionConfig(): void {
  const errors: string[] = [];

  const positiveInts: Array<[string, number]> = [
    ['COMMISSION_RULES_CACHE_TTL_MS', COMMISSION_RULES_CACHE_TTL_MS],
    ['COMMISSION_TIER_LOOKUP_TIMEOUT_MS', COMMISSION_TIER_LOOKUP_TIMEOUT_MS],
    ['COMMISSION_ADMIN_RATE_LIMIT_PER_MINUTE', COMMISSION_ADMIN_RATE_LIMIT_PER_MINUTE],
  ];
  for (const [name, value] of positiveInts) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${name} must be a positive integer, got ${value}`);
    }
  }

  const bpsBounded: Array<[string, number]> = [
    ['COMMISSION_MAX_HOST_RATE_BPS', COMMISSION_MAX_HOST_RATE_BPS],
    ['COMMISSION_MAX_CLEANER_RATE_BPS', COMMISSION_MAX_CLEANER_RATE_BPS],
    ['OFFER_HOST_FEE_RATE_BPS', OFFER_HOST_FEE_RATE_BPS],
    ['OFFER_CLEANER_RATE_BPS', OFFER_CLEANER_RATE_BPS],
  ];
  for (const [name, value] of bpsBounded) {
    if (!Number.isInteger(value) || value < 0 || value > BPS_MAX) {
      errors.push(`${name} must be an integer in [0, ${BPS_MAX}], got ${value}`);
    }
  }

  if (OFFER_HOST_FEE_RATE_BPS > COMMISSION_MAX_HOST_RATE_BPS) {
    errors.push(
      `OFFER_HOST_FEE_RATE_BPS (${OFFER_HOST_FEE_RATE_BPS}) exceeds ` +
        `COMMISSION_MAX_HOST_RATE_BPS (${COMMISSION_MAX_HOST_RATE_BPS})`,
    );
  }
  if (OFFER_CLEANER_RATE_BPS > COMMISSION_MAX_CLEANER_RATE_BPS) {
    errors.push(
      `OFFER_CLEANER_RATE_BPS (${OFFER_CLEANER_RATE_BPS}) exceeds ` +
        `COMMISSION_MAX_CLEANER_RATE_BPS (${COMMISSION_MAX_CLEANER_RATE_BPS})`,
    );
  }

  if (!COMMISSION_CACHE_INVALIDATION_CHANNEL.trim()) {
    errors.push('COMMISSION_CACHE_INVALIDATION_CHANNEL must be a non-empty string');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid commission configuration:\n- ${errors.join('\n- ')}`);
  }
}
