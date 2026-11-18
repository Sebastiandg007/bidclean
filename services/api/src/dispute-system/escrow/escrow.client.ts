import { Injectable } from '@nestjs/common';

import { DisputeService } from '../../payments/disputes/dispute.service';
import { DisputeSettlementService } from '../../payments/disputes/dispute-settlement.service';
import { PaymentsRepository } from '../../payments/payments.repository';
import {
  DisputeEffectOutcome,
  DisputeEffectResult,
  PayoutStatus,
} from '../../payments/payments.types';
import { DisputePhase, EscrowActionOutcome, EscrowActionResult } from '../dispute.types';

/**
 * EscrowClient — the thin, injectable, mockable bridge to Spec 9 (the ONLY money seam, Spec 21).
 *
 * dispute-system holds NO Stripe keys and imports NO Stripe SDK. It reads one authoritative payment
 * field to derive `phase`, sets/clears the platform dispute block (contract (a): `setDisputeStatus`
 * atomically wins against a not-yet-accepted release), and drives the resolution's financial action
 * through Spec 9's `DisputeSettlementService`, translating its `DisputeEffectOutcome` into the
 * dispute-system `EscrowActionOutcome` (contract (b) accepted `NO_OP`; contract (c) `BLOCKED`/
 * `PAYMENT_ALREADY_SETTLED`). It never computes amounts, ceilings, or reversals itself.
 */
@Injectable()
export class EscrowClient {
  constructor(
    private readonly disputes: DisputeService,
    private readonly settlement: DisputeSettlementService,
    private readonly payments: PaymentsRepository,
  ) {}

  /**
   * Derive `phase` from Spec 9's ONE authoritative field: `POST_RELEASE` iff
   * `payout_status IN ('TRANSFER_CREATED','PAID')`, else `PRE_RELEASE`. Defaults to `PRE_RELEASE`
   * when the payment is unknown (a not-yet-materialized payment cannot be post-release).
   */
  async readPaymentPhase(paymentId: string): Promise<DisputePhase> {
    const settlement = await this.payments.findDisputeSettlement(paymentId);
    if (!settlement) {
      return DisputePhase.PRE_RELEASE;
    }
    const isPostRelease =
      settlement.payoutStatus === PayoutStatus.TRANSFER_CREATED ||
      settlement.payoutStatus === PayoutStatus.PAID;
    return isPostRelease ? DisputePhase.POST_RELEASE : DisputePhase.PRE_RELEASE;
  }

  /**
   * Set (`OPEN`) or clear (`NONE`) the platform dispute block. Idempotent. `OPEN` atomically wins
   * against a not-yet-accepted release (contract (a)); `NONE` is requested only after the financial
   * action has landed (clear-escrow-LAST).
   */
  async setDisputeStatus(paymentId: string, target: 'OPEN' | 'NONE'): Promise<void> {
    await this.disputes.setPlatformDisputeStatus(paymentId, target === 'OPEN');
  }

  /** Release the held funds to the Cleaner (FAVOR_CLEANER). Post-release → accepted `NO_OP`. */
  async release(paymentId: string): Promise<EscrowActionOutcome> {
    return this.toActionOutcome(await this.settlement.releaseForDispute(paymentId));
  }

  /** Refund the Host (FAVOR_HOST/PARTIAL); `amountCents = null` = full. Spec 9 ceilings the amount. */
  async refund(paymentId: string, amountCents: number | null): Promise<EscrowActionOutcome> {
    return this.toActionOutcome(await this.settlement.refundForDispute(paymentId, amountCents));
  }

  /** Translate Spec 9's `DisputeEffectOutcome` into the dispute-system `EscrowActionOutcome`. */
  private toActionOutcome(outcome: DisputeEffectOutcome): EscrowActionOutcome {
    return {
      result: OUTCOME_MAP[outcome.result],
      effectiveAmountCents: outcome.effectiveAmountCents,
      reason: outcome.reason,
    };
  }
}

/** Spec 9 effect result → dispute-system escrow action result (1:1). */
const OUTCOME_MAP: Record<DisputeEffectResult, EscrowActionResult> = {
  [DisputeEffectResult.APPLIED]: EscrowActionResult.APPLIED,
  [DisputeEffectResult.CEILING_CLAMPED]: EscrowActionResult.CEILING_CLAMPED,
  [DisputeEffectResult.NO_OP]: EscrowActionResult.NO_OP,
  [DisputeEffectResult.BLOCKED]: EscrowActionResult.BLOCKED,
};
