/**
 * Offers module constants.
 *
 * Route names, service type configs, state color mappings,
 * validation limits, and design tokens for offer screens.
 */

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
  DRAFT: '#8E8E93',
  PUBLISHED: '#FFD93D',
  ACTIVE: '#00F5D4',
  MATCHED: '#5E5CE6',
  COMPLETED: '#30D158',
  CANCELLED: '#FF6B6B',
  EXPIRED: '#636366',
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

export const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  accentSubtle: 'rgba(0, 245, 212, 0.12)',
  accentMuted: 'rgba(0, 245, 212, 0.08)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  border: 'rgba(255, 255, 255, 0.2)',
  error: '#FF6B6B',
  errorSubtle: 'rgba(255, 107, 107, 0.1)',
  success: '#00F5D4',
  warning: '#FFD93D',
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
} as const;

// ─── Animation Config ────────────────────────────────────────────────────────

export const SPRING_CONFIG = {
  damping: 14,
  stiffness: 100,
  mass: 1,
} as const;
