/**
 * Payments screen constants.
 *
 * Route names, endpoint builders, the idempotency header, and i18n keys. The backend
 * is authoritative for all payment state; the client only renders and requests.
 */

/** Navigation route names for the payments stack */
export const PAYMENTS_ROUTES = {
  HostPaymentMethod: 'HostPaymentMethod',
  CleanerPayoutOnboarding: 'CleanerPayoutOnboarding',
  PaymentStatus: 'PaymentStatus',
} as const;

/** REST endpoint builders */
export const PAYMENTS_ENDPOINTS = {
  ONBOARDING: '/payments/connect/onboarding',
  ACCOUNT_STATUS: '/payments/connect/status',
  PAYMENT_FOR_OFFER: (offerId: string) => `/payments/offers/${offerId}`,
  REFUND: (offerId: string) => `/payments/offers/${offerId}/refund`,
} as const;

/** Header carrying the client-generated idempotency key */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** Stripe publishable key (safe to embed in the client) */
export const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

/** i18n error keys for payment operations */
export const PAYMENTS_ERROR_KEYS = {
  ONBOARDING: 'payments.error.onboarding_failed',
  ACCOUNT_STATUS: 'payments.error.account_status_failed',
  FETCH_PAYMENT: 'payments.error.fetch_payment_failed',
  REFUND: 'payments.error.refund_failed',
  REFUND_BLOCKED: 'payments.error.refund_blocked',
  REFUND_CEILING: 'payments.error.refund_ceiling',
} as const;
