/**
 * UI mapping helpers: map payment/payout/dispute statuses to i18n label keys and
 * semantic badge tones. Pure, so they are trivially testable and reusable.
 */

import type { BadgeTone } from './components/PaymentStatusBadge';
import type { DisputeStatus, PaymentStatus, PayoutStatus } from './payments.types';

const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  PENDING: 'neutral',
  PROCESSING: 'neutral',
  HELD: 'positive',
  RELEASED: 'positive',
  REFUNDED: 'warning',
  PARTIALLY_REFUNDED: 'warning',
  FAILED: 'danger',
};

const PAYOUT_TONE: Record<PayoutStatus, BadgeTone> = {
  NOT_READY: 'neutral',
  PENDING: 'warning',
  TRANSFER_CREATED: 'positive',
  PAID: 'positive',
  REVERSED: 'danger',
};

const DISPUTE_TONE: Record<DisputeStatus, BadgeTone> = {
  NONE: 'neutral',
  OPEN: 'danger',
  WON: 'positive',
  LOST: 'warning',
};

export function paymentLabelKey(status: PaymentStatus): string {
  return `status.payment.${status}`;
}

export function payoutLabelKey(status: PayoutStatus): string {
  return `status.payout.${status}`;
}

export function disputeLabelKey(status: DisputeStatus): string {
  return `status.dispute.${status}`;
}

export function paymentTone(status: PaymentStatus): BadgeTone {
  return PAYMENT_TONE[status];
}

export function payoutTone(status: PayoutStatus): BadgeTone {
  return PAYOUT_TONE[status];
}

export function disputeTone(status: DisputeStatus): BadgeTone {
  return DISPUTE_TONE[status];
}
