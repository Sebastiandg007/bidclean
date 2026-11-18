/**
 * Offers module constants.
 *
 * Route names, service type configs, state color mappings,
 * validation limits, and design tokens for offer screens.
 */

import { palette } from '../../theme/primitives';
import type { OfferState, ServiceType } from './offers.types';

// ─── Route Names ─────────────────────────────────────────────────────────────

export const OFFER_ROUTES = {
  OfferList: 'OfferList',
  CreateOffer: 'CreateOffer',
  OfferConfirmation: 'OfferConfirmation',
  OfferDetail: 'OfferDetail',
} as const;

// ─── Service Type Configuration ──────────────────────────────────────────────

export interface ServiceTypeConfig {
  value: ServiceType;
  labelKey: string;
  icon: string;
}

/** All available service types with i18n keys and icons */
export const SERVICE_TYPES: ServiceTypeConfig[] = [
  { value: 'standard', labelKey: 'offers.serviceType.standard', icon: '🧹' },
  { value: 'deep', labelKey: 'offers.serviceType.deep', icon: '✨' },
  { value: 'move_in_out', labelKey: 'offers.serviceType.move_in_out', icon: '📦' },
  { value: 'post_construction', labelKey: 'offers.serviceType.post_construction', icon: '🏗️' },
  { value: 'post_event', labelKey: 'offers.serviceType.post_event', icon: '🎉' },
  { value: 'recurring', labelKey: 'offers.serviceType.recurring', icon: '🔄' },
];

// ─── Offer State Color Mapping ───────────────────────────────────────────────

export const STATE_COLORS: Record<OfferState, string> = {
  DRAFT: palette.stateGrey,
  PUBLISHED: palette.warning,
  ACTIVE: palette.mint,
  MATCHED: palette.stateIndigo,
  COMPLETED: palette.stateGreen,
  CANCELLED: palette.offerDanger,
  EXPIRED: palette.stateGreyDim,
};

// ─── Validation Limits ───────────────────────────────────────────────────────

export const OFFER_MIN_LEAD_MINUTES = Number(
  process.env.EXPO_PUBLIC_OFFER_MIN_LEAD_MINUTES ?? '60',
);

export const OFFER_MIN_DURATION_MINUTES = Number(
  process.env.EXPO_PUBLIC_OFFER_MIN_DURATION_MINUTES ?? '30',
);

export const OFFER_MAX_DURATION_MINUTES = Number(
  process.env.EXPO_PUBLIC_OFFER_MAX_DURATION_MINUTES ?? '480',
);

/** Default step increment for duration selector in minutes (from env, default 30) */
export const OFFER_DURATION_STEP_MINUTES = Number(
  process.env.EXPO_PUBLIC_OFFER_DURATION_STEP_MINUTES ?? '30',
);

// ─── Pagination ──────────────────────────────────────────────────────────────

export const OFFERS_PAGE_SIZE = Number(
  process.env.EXPO_PUBLIC_OFFERS_PAGE_SIZE ?? '20',
);

// ─── Design Tokens ───────────────────────────────────────────────────────────

/**
 * Shared offer palette. Maps onto dark theme primitives by reference (no raw hex here). Many offer
 * surfaces still consume this static object at module scope; values equal the previous hardcoded
 * palette, preserving the dark appearance.
 */
export const COLORS = {
  background: palette.obsidian,
  card: palette.surfaceDark,
  accent: palette.mint,
  accentSubtle: palette.accentSubtle,
  accentMuted: palette.accentMuted,
  textPrimary: palette.white,
  textSecondary: palette.whiteAlpha60,
  border: palette.whiteAlpha20,
  error: palette.offerDanger,
  errorSubtle: palette.errorSubtle,
  success: palette.mint,
  warning: palette.warning,
  disabled: palette.whiteAlpha30,
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const FONT_SIZE = {
  title: 22,
  subtitle: 14,
  body: 16,
  button: 17,
  label: 13,
  caption: 11,
  icon: 32,
  large: 28,
} as const;

// ─── Animation Config ────────────────────────────────────────────────────────

export const SPRING_CONFIG = {
  damping: 14,
  stiffness: 100,
  mass: 1,
} as const;
