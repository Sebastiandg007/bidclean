import { DisputeStatus, PaymentStatus, PayoutStatus } from './payments.types';

/**
 * Three pure state machines for the orthogonal payment lifecycles.
 *
 * Each machine exposes an ALLOWED_TRANSITIONS map and a pure `validateXxxTransition`
 * function returning `{ valid, reason? }`. The machines never throw — the calling
 * service throws based on the result. Lifecycle orthogonality (Property P12) is a
 * consequence of validating each status independently.
 */

/** Result of a transition validation */
export interface TransitionResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/** Allowed payment (financial) transitions */
export const PAYMENT_ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.PROCESSING, PaymentStatus.FAILED],
  [PaymentStatus.PROCESSING]: [PaymentStatus.HELD, PaymentStatus.FAILED],
  [PaymentStatus.FAILED]: [PaymentStatus.PROCESSING], // retry via a new attempt
  [PaymentStatus.HELD]: [
    PaymentStatus.RELEASED,
    PaymentStatus.REFUNDED,
    PaymentStatus.PARTIALLY_REFUNDED,
  ],
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.RELEASED, PaymentStatus.REFUNDED],
  [PaymentStatus.RELEASED]: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED], // post-release refund + reversal
  [PaymentStatus.REFUNDED]: [],
};

/** Allowed dispute transitions */
export const DISPUTE_ALLOWED_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  [DisputeStatus.NONE]: [DisputeStatus.OPEN],
  [DisputeStatus.OPEN]: [DisputeStatus.WON, DisputeStatus.LOST],
  [DisputeStatus.WON]: [],
  [DisputeStatus.LOST]: [],
};

/** Allowed payout transitions */
export const PAYOUT_ALLOWED_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  [PayoutStatus.NOT_READY]: [PayoutStatus.PENDING, PayoutStatus.TRANSFER_CREATED],
  [PayoutStatus.PENDING]: [PayoutStatus.TRANSFER_CREATED],
  [PayoutStatus.TRANSFER_CREATED]: [PayoutStatus.PAID, PayoutStatus.REVERSED],
  [PayoutStatus.PAID]: [PayoutStatus.REVERSED],
  [PayoutStatus.REVERSED]: [],
};

/** Terminal payment status (fully refunded) */
export const TERMINAL_PAYMENT_STATUSES: PaymentStatus[] = [PaymentStatus.REFUNDED];

function validate<T extends string>(
  allowed: Record<T, T[]>,
  current: T,
  target: T,
): TransitionResult {
  const next = allowed[current] ?? [];
  if (!next.includes(target)) {
    return { valid: false, reason: `Transition from ${current} to ${target} is not allowed` };
  }
  return { valid: true };
}

/** Validate a payment (financial) transition */
export function validatePaymentTransition(
  current: PaymentStatus,
  target: PaymentStatus,
): TransitionResult {
  return validate(PAYMENT_ALLOWED_TRANSITIONS, current, target);
}

/** Validate a dispute transition */
export function validateDisputeTransition(
  current: DisputeStatus,
  target: DisputeStatus,
): TransitionResult {
  return validate(DISPUTE_ALLOWED_TRANSITIONS, current, target);
}

/** Validate a payout transition */
export function validatePayoutTransition(
  current: PayoutStatus,
  target: PayoutStatus,
): TransitionResult {
  return validate(PAYOUT_ALLOWED_TRANSITIONS, current, target);
}

/** Whether a payment status is terminal (no further financial transitions) */
export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return TERMINAL_PAYMENT_STATUSES.includes(status);
}
