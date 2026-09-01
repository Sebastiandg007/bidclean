/**
 * ad-provider.factory — Config/environment-driven selection of the concrete `AdProvider`.
 *
 * Selection is UNAMBIGUOUS per environment (Req 2.4 / 7.4 / P3 / P8):
 *   - Test/CI          → MockAdProvider (zero real ad requests).
 *   - Development       → AdMobAdProvider with the official TEST unit ids (or mock when explicitly
 *                         selected via `EXPO_PUBLIC_ADS_PROVIDER=mock`).
 *   - Production        → AdMobAdProvider when config is valid; otherwise ads DISABLED — a
 *                         production build NEVER falls back to the mock.
 *
 * "Disabled" is represented by a null provider: the render decision downstream stays false and the
 * radar renders offers only.
 */

import {
  ADS_PROVIDER,
  AdProviderName,
  hasProductionAdMobConfig,
  resolveBannerUnitId,
} from './ads.constants';
import type { AdEnvironment, AdPlatform, AdProvider } from './ads.types';
import { AdMobAdProvider } from './providers/admob.provider';
import { MockAdProvider } from './providers/mock.provider';

// ─── Environment detection ─────────────────────────────────────────────────────

/** True under Jest/CI, where no native SDK or real ad request is permitted. */
function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined
  );
}

/** Resolve the build environment for provider selection. */
export function resolveAdEnvironment(): AdEnvironment {
  const globalDev = (globalThis as { __DEV__?: boolean }).__DEV__;
  return globalDev === true ? 'development' : 'production';
}

// ─── Selection inputs (explicit, so the matrix is unit-testable) ────────────────

/** The resolved inputs that determine provider selection. */
export interface AdProviderSelection {
  readonly platform: AdPlatform;
  readonly environment: AdEnvironment;
  readonly isTest: boolean;
  readonly providerSelector: string;
}

/**
 * Pure selection: given fully-resolved inputs, build the provider or return null (disabled).
 * The mock is used only when `isTest` or the selector is explicitly `mock` — a production build
 * with missing config returns null, never the mock.
 */
export function selectAdProvider(
  selection: AdProviderSelection,
): AdProvider | null {
  const { platform, environment, isTest, providerSelector } = selection;
  if (isTest || providerSelector === AdProviderName.MOCK) {
    return new MockAdProvider();
  }
  if (environment === 'development') {
    // Dev always has a usable unit id (falls back to the official test id).
    return new AdMobAdProvider(resolveBannerUnitId(platform, 'development'));
  }
  // Production: require valid config; otherwise DISABLE (never the mock).
  if (!hasProductionAdMobConfig(platform)) {
    return null;
  }
  return new AdMobAdProvider(resolveBannerUnitId(platform, 'production'));
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Build the concrete provider for the current platform/environment, or null when ads are disabled
 * (missing production config). Resolves the real environment then delegates to `selectAdProvider`.
 */
export function createAdProvider(platform: AdPlatform): AdProvider | null {
  return selectAdProvider({
    platform,
    environment: resolveAdEnvironment(),
    isTest: isTestEnvironment(),
    providerSelector: ADS_PROVIDER,
  });
}
