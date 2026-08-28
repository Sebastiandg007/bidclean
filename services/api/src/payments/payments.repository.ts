import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { StripeAccount } from './entities/stripe-account.entity';
import { PaymentEvent } from './entities/payment-event.entity';
import {
  AttemptStatus,
  DisputeStatus,
  PaymentEventSource,
  PaymentStatus,
  PayoutStatus,
} from './payments.types';
import {
  validateDisputeTransition,
  validatePaymentTransition,
  validatePayoutTransition,
} from './payment-state-machine';
import { SanitizedPayload } from './payment-payload.sanitizer';

/** Money snapshot captured when the payment is created */
export interface PaymentSnapshot {
  readonly agreedPriceCents: number;
  readonly hostTotalCents: number;
  readonly cleanerPayoutCents: number;
  readonly platformGrossRevenueCents: number;
  readonly currency: string;
}

/** Parameters for upserting the payment row for an offer */
export interface UpsertPaymentParams {
  readonly offerId: string;
  readonly hostId: string;
  readonly cleanerId: string;
  readonly snapshot: PaymentSnapshot;
}

/** Parameters for appending a payment event to the ledger */
export interface AppendEventParams {
  readonly paymentId: string | null;
  readonly source: PaymentEventSource;
  readonly eventType: string;
  readonly stripeEventId?: string | null;
  readonly idempotencyKey?: string | null;
  readonly amountCents?: number | null;
  readonly currency?: string | null;
  readonly payload: SanitizedPayload | Record<string, unknown>;
}

/** Parameters for upserting a Cleaner's Stripe account */
export interface UpsertStripeAccountParams {
  readonly cleanerId: string;
  readonly stripeAccountId: string;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
  readonly country: string | null;
  readonly defaultCurrency: string | null;
}

/**
 * Payments repository.
 *
 * Owns all reads/writes to payments, payment_attempts, stripe_accounts, and
 * payment_events. Multi-step mutations run in a transaction that locks the payment
 * row with `SELECT ... FOR UPDATE`; every status change is validated against its
 * pure state machine before persisting. NEVER writes the `offers` table.
 */
@Injectable()
export class PaymentsRepository {
  /** Postgres unique-violation error code */
  private static readonly UNIQUE_VIOLATION = '23505';

  constructor(private readonly dataSource: DataSource) {}

  // ─── Reads ───────────────────────────────────────────────────────────────

  /** Find the payment for an offer (P3: unique per offer). */
  async findPaymentByOffer(offerId: string): Promise<Payment | null> {
    return this.dataSource.getRepository(Payment).findOne({ where: { offerId } });
  }

  /** Find a payment by id. */
  async findPaymentById(paymentId: string): Promise<Payment | null> {
    return this.dataSource.getRepository(Payment).findOne({ where: { id: paymentId } });
  }

  /** List attempts for a payment ordered by attempt number ascending. */
  async listAttempts(paymentId: string): Promise<PaymentAttempt[]> {
    return this.dataSource.getRepository(PaymentAttempt).find({
      where: { paymentId },
      order: { attemptNumber: 'ASC' },
    });
  }

  /** Find a Cleaner's Stripe account. */
  async findAccountByCleaner(cleanerId: string): Promise<StripeAccount | null> {
    return this.dataSource.getRepository(StripeAccount).findOne({ where: { cleanerId } });
  }

  /**
   * Resolve the agreed price for a matched offer. Prefers the ACCEPTED negotiation
   * proposal's price (negotiated match) and falls back to the offer's offered price
   * for a direct/auto match. Read-only cross-module query (never writes offers).
   */
  async resolveAgreedPriceCents(offerId: string): Promise<number | null> {
    const negotiated = await this.dataSource.query<{ proposed_price_cents: number }[]>(
      `SELECT p."proposed_price_cents"
       FROM "negotiation_proposals" p
       INNER JOIN "negotiation_threads" t ON t."id" = p."thread_id"
       WHERE t."offer_id" = $1 AND p."status" = 'ACCEPTED'
       ORDER BY p."sequence_number" DESC
       LIMIT 1`,
      [offerId],
    );
    if (negotiated[0]) {
      return negotiated[0].proposed_price_cents;
    }
    const offer = await this.dataSource.query<{ offered_price_cents: number }[]>(
      `SELECT "offered_price_cents" FROM "offers" WHERE "id" = $1 LIMIT 1`,
      [offerId],
    );
    return offer[0]?.offered_price_cents ?? null;
  }

  /** Load an offer's currency and snapshotted commission rate bps. */
  async findOfferRates(offerId: string): Promise<{
    currency: string;
    hostServiceFeeRateBps: number;
    cleanerCommissionRateBps: number;
  } | null> {
    const rows = await this.dataSource.query<
      {
        currency: string;
        host_service_fee_rate_bps: number;
        cleaner_commission_rate_bps: number;
      }[]
    >(
      `SELECT "currency", "host_service_fee_rate_bps", "cleaner_commission_rate_bps"
       FROM "offers" WHERE "id" = $1 LIMIT 1`,
      [offerId],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      currency: row.currency,
      hostServiceFeeRateBps: row.host_service_fee_rate_bps,
      cleanerCommissionRateBps: row.cleaner_commission_rate_bps,
    };
  }

  /** Whether an event with this Stripe event id was already recorded (P8 dedup). */
  async hasProcessedStripeEvent(stripeEventId: string): Promise<boolean> {
    const count = await this.dataSource
      .getRepository(PaymentEvent)
      .count({ where: { stripeEventId } });
    return count > 0;
  }

  /** Held payments past the auto-release window and not disputed. */
  async findPaymentsForAutoRelease(autoReleaseHours: number): Promise<Payment[]> {
    return this.dataSource.query<Payment[]>(
      `SELECT * FROM "payments"
       WHERE "payment_status" = 'HELD'
         AND "dispute_status" = 'NONE'
         AND "held_at" IS NOT NULL
         AND "held_at" + ($1 || ' hours')::interval < NOW()`,
      [autoReleaseHours],
    );
  }

  /** Payments awaiting payout for a Cleaner (deferred release). */
  async findPendingPayoutsForCleaner(cleanerId: string): Promise<Payment[]> {
    return this.dataSource.getRepository(Payment).find({
      where: { cleanerId, payoutStatus: PayoutStatus.PENDING },
    });
  }

  /** Accounts not payout-enabled (reconciliation candidates). */
  async findAccountsNotPayoutEnabled(limit: number): Promise<StripeAccount[]> {
    return this.dataSource.getRepository(StripeAccount).find({
      where: { payoutsEnabled: false },
      order: { lastSyncedAt: 'ASC' },
      take: limit,
    });
  }

  /** Payments stuck in PROCESSING (reconciliation candidates). */
  async findProcessingPayments(limit: number): Promise<Payment[]> {
    return this.dataSource.getRepository(Payment).find({
      where: { paymentStatus: PaymentStatus.PROCESSING },
      take: limit,
    });
  }

  // ─── Payment + attempt writes ──────────────────────────────────────────────

  /**
   * Create the PENDING payment for an offer (or reuse an existing row) and insert a
   * fresh attempt, all under a row lock so the attempt_number stays strictly
   * increasing. Returns the payment id and the new attempt.
   */
  async createPaymentWithAttempt(
    params: UpsertPaymentParams,
    stripePaymentIntentId: string,
    amountCents: number,
  ): Promise<{ payment: Payment; attempt: PaymentAttempt }> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const payment = await this.upsertPaymentRow(manager, params);

      // Lock the payment row to serialize attempt_number allocation.
      const lockedRows = await manager.query<{ max_attempt: number | null }[]>(
        `SELECT MAX("attempt_number") AS max_attempt FROM "payment_attempts"
         WHERE "payment_id" = $1 FOR UPDATE`,
        [payment.id],
      );
      const nextAttempt = (lockedRows[0]?.max_attempt ?? 0) + 1;

      const attemptRepo = manager.getRepository(PaymentAttempt);
      const attempt = await attemptRepo.save(
        attemptRepo.create({
          paymentId: payment.id,
          attemptNumber: nextAttempt,
          stripePaymentIntentId,
          stripeChargeId: null,
          status: AttemptStatus.PROCESSING,
          failureReason: null,
          amountCents,
          currency: params.snapshot.currency,
        }),
      );

      // Move payment PENDING -> PROCESSING for this attempt.
      await this.transitionPaymentStatus(manager, payment.id, PaymentStatus.PROCESSING);

      return { payment, attempt };
    });
  }

  /** Idempotently create the payment row for an offer, or reuse the existing one. */
  private async upsertPaymentRow(
    manager: EntityManager,
    params: UpsertPaymentParams,
  ): Promise<Payment> {
    const repo = manager.getRepository(Payment);
    const existing = await repo.findOne({ where: { offerId: params.offerId } });
    if (existing) {
      return existing;
    }
    try {
      return await repo.save(
        repo.create({
          offerId: params.offerId,
          hostId: params.hostId,
          cleanerId: params.cleanerId,
          paymentStatus: PaymentStatus.PENDING,
          disputeStatus: DisputeStatus.NONE,
          payoutStatus: PayoutStatus.NOT_READY,
          currency: params.snapshot.currency,
          agreedPriceCents: params.snapshot.agreedPriceCents,
          hostTotalCents: params.snapshot.hostTotalCents,
          cleanerPayoutCents: params.snapshot.cleanerPayoutCents,
          platformGrossRevenueCents: params.snapshot.platformGrossRevenueCents,
          stripeFeeCents: 0,
          netPlatformRevenueCents: 0,
          refundedAmountCents: 0,
          reversedAmountCents: 0,
          stripeTransferId: null,
          heldAt: null,
          releasedAt: null,
        }),
      );
    } catch (error) {
      // A concurrent offer.matched raced us to the unique offer_id — reuse its row (P3).
      if (this.isUniqueViolation(error)) {
        const raced = await repo.findOne({ where: { offerId: params.offerId } });
        if (raced) {
          return raced;
        }
      }
      throw error;
    }
  }

  /**
   * Persist the real Stripe PaymentIntent id on an attempt as soon as the intent is
   * created, replacing the `pending:` placeholder. This closes the crash window between
   * the Stripe charge and `markChargeSucceeded`: reconciliation can then retrieve the
   * intent from Stripe and converge the payment (P11).
   */
  async recordAttemptIntentId(attemptId: string, stripePaymentIntentId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "payment_attempts"
       SET "stripe_payment_intent_id" = $1, "updated_at" = NOW()
       WHERE "id" = $2 AND "status" = 'PROCESSING'`,
      [stripePaymentIntentId, attemptId],
    );
  }

  /**
   * Mark an attempt SUCCEEDED and move the payment to HELD, recording the Stripe fee.
   * Overwrites the placeholder `stripe_payment_intent_id` with the real intent id so the
   * reconciliation sweep can heal a crashed charge (never leaves a `pending:` intent).
   */
  async markChargeSucceeded(params: {
    paymentId: string;
    attemptId: string;
    stripePaymentIntentId: string;
    stripeChargeId: string;
    stripeFeeCents: number;
  }): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      await manager.query(
        `UPDATE "payment_attempts"
         SET "status" = $1, "stripe_payment_intent_id" = $2, "stripe_charge_id" = $3, "updated_at" = NOW()
         WHERE "id" = $4 AND "status" = 'PROCESSING'`,
        [AttemptStatus.SUCCEEDED, params.stripePaymentIntentId, params.stripeChargeId, params.attemptId],
      );

      const payment = await this.lockPayment(manager, params.paymentId);
      this.assertPaymentTransition(payment.payment_status, PaymentStatus.HELD);

      const gross = payment.platform_gross_revenue_cents;
      const netRevenue = gross - params.stripeFeeCents;

      await manager.query(
        `UPDATE "payments"
         SET "payment_status" = $1,
             "stripe_fee_cents" = $2,
             "net_platform_revenue_cents" = $3,
             "held_at" = COALESCE("held_at", NOW()),
             "updated_at" = NOW()
         WHERE "id" = $4`,
        [PaymentStatus.HELD, params.stripeFeeCents, netRevenue, params.paymentId],
      );
    });
  }

  /** Mark an attempt FAILED and move the payment to FAILED. */
  async markChargeFailed(params: {
    paymentId: string;
    attemptId: string;
    failureReason: string;
  }): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      await manager.query(
        `UPDATE "payment_attempts"
         SET "status" = $1, "failure_reason" = $2, "updated_at" = NOW()
         WHERE "id" = $3 AND "status" = 'PROCESSING'`,
        [AttemptStatus.FAILED, params.failureReason, params.attemptId],
      );
      const payment = await this.lockPayment(manager, params.paymentId);
      this.assertPaymentTransition(payment.payment_status, PaymentStatus.FAILED);
      await manager.query(
        `UPDATE "payments" SET "payment_status" = $1, "updated_at" = NOW() WHERE "id" = $2`,
        [PaymentStatus.FAILED, params.paymentId],
      );
    });
  }

  /**
   * Persist a payout release: set payout_status TRANSFER_CREATED, payment_status
   * RELEASED, store the transfer id. Guarded by a row lock + state validation so a
   * concurrent trigger cannot release twice (P4).
   */
  async markReleased(params: { paymentId: string; stripeTransferId: string }): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const payment = await this.lockPayment(manager, params.paymentId);
      // Idempotent under concurrent triggers (P4): if another writer already recorded
      // the release inside its own lock, this is a clean no-op — not an error. The
      // Stripe Transfer itself is deduped by the `release:paymentId` idempotency key.
      if (
        payment.payout_status === PayoutStatus.TRANSFER_CREATED ||
        payment.payout_status === PayoutStatus.PAID
      ) {
        return;
      }
      this.assertPayoutTransition(payment.payout_status, PayoutStatus.TRANSFER_CREATED);
      this.assertPaymentTransition(payment.payment_status, PaymentStatus.RELEASED);
      await manager.query(
        `UPDATE "payments"
         SET "payout_status" = $1, "payment_status" = $2,
             "stripe_transfer_id" = $3, "released_at" = NOW(), "updated_at" = NOW()
         WHERE "id" = $4`,
        [PayoutStatus.TRANSFER_CREATED, PaymentStatus.RELEASED, params.stripeTransferId, params.paymentId],
      );
    });
  }

  /** Defer a payout: set payout_status PENDING (Cleaner not payout-enabled yet, P6). */
  async markPayoutDeferred(paymentId: string): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const payment = await this.lockPayment(manager, paymentId);
      this.assertPayoutTransition(payment.payout_status, PayoutStatus.PENDING);
      await manager.query(
        `UPDATE "payments" SET "payout_status" = $1, "updated_at" = NOW() WHERE "id" = $2`,
        [PayoutStatus.PENDING, paymentId],
      );
    });
  }

  /** Set the payout status directly (webhook-driven: PAID, REVERSED). */
  async setPayoutStatus(paymentId: string, target: PayoutStatus): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const payment = await this.lockPayment(manager, paymentId);
      this.assertPayoutTransition(payment.payout_status, target);
      await manager.query(
        `UPDATE "payments" SET "payout_status" = $1, "updated_at" = NOW() WHERE "id" = $2`,
        [target, paymentId],
      );
    });
  }

  /** Transition the dispute status (orthogonal to payment_status). */
  async setDisputeStatus(paymentId: string, target: DisputeStatus): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const payment = await this.lockPayment(manager, paymentId);
      this.assertDisputeTransition(payment.dispute_status, target);
      await manager.query(
        `UPDATE "payments" SET "dispute_status" = $1, "updated_at" = NOW() WHERE "id" = $2`,
        [target, paymentId],
      );
    });
  }

  /**
   * Apply a refund and/or reversal: increment refunded/reversed amounts (DB CHECK
   * enforces ceilings, P7), recompute net revenue, and set the resulting payment
   * status. Runs under a row lock.
   */
  async applyRefund(params: {
    paymentId: string;
    refundAmountCents: number;
    reversalAmountCents: number;
    resultingStatus: PaymentStatus;
  }): Promise<void> {
    // Defensive boundary guards: the refund policy enforces these upstream, but this
    // method is public and its net-revenue math relies on them holding.
    if (params.refundAmountCents < 0 || params.reversalAmountCents < 0) {
      throw new Error('Refund and reversal amounts must be non-negative');
    }
    if (params.reversalAmountCents > params.refundAmountCents) {
      throw new Error('Reversal amount cannot exceed the refund amount');
    }

    await this.dataSource.transaction(async (manager: EntityManager) => {
      const payment = await this.lockPayment(manager, params.paymentId);
      this.assertPaymentTransition(payment.payment_status, params.resultingStatus);

      const newRefunded = payment.refunded_amount_cents + params.refundAmountCents;
      const newReversed = payment.reversed_amount_cents + params.reversalAmountCents;
      // Net platform revenue only reflects the platform's own commission line. The
      // Stripe processing fee was subtracted once at capture and stays absorbed (never
      // returned by Stripe on a refund). The platform's share of this refund is the
      // portion NOT recovered from the Cleaner via reversal: (refund - reversal). The
      // Cleaner's share is recovered by the Transfer Reversal, so it doesn't touch
      // platform revenue. Guaranteed >= 0 by the boundary guards above.
      const platformRefundShare = params.refundAmountCents - params.reversalAmountCents;
      const newNetRevenue = payment.net_platform_revenue_cents - platformRefundShare;

      await manager.query(
        `UPDATE "payments"
         SET "refunded_amount_cents" = $1,
             "reversed_amount_cents" = $2,
             "net_platform_revenue_cents" = $3,
             "payment_status" = $4,
             "updated_at" = NOW()
         WHERE "id" = $5`,
        [newRefunded, newReversed, newNetRevenue, params.resultingStatus, params.paymentId],
      );
    });
  }

  // ─── Stripe account writes ─────────────────────────────────────────────────

  /** Create or update the Cleaner's Stripe account with fresh capability flags. */
  async upsertStripeAccount(params: UpsertStripeAccountParams): Promise<StripeAccount> {
    const repo = this.dataSource.getRepository(StripeAccount);
    const existing = await repo.findOne({ where: { cleanerId: params.cleanerId } });
    if (existing) {
      existing.stripeAccountId = params.stripeAccountId;
      existing.chargesEnabled = params.chargesEnabled;
      existing.payoutsEnabled = params.payoutsEnabled;
      existing.detailsSubmitted = params.detailsSubmitted;
      existing.country = params.country;
      existing.defaultCurrency = params.defaultCurrency;
      existing.lastSyncedAt = new Date();
      return repo.save(existing);
    }
    return repo.save(
      repo.create({
        cleanerId: params.cleanerId,
        stripeAccountId: params.stripeAccountId,
        chargesEnabled: params.chargesEnabled,
        payoutsEnabled: params.payoutsEnabled,
        detailsSubmitted: params.detailsSubmitted,
        country: params.country,
        defaultCurrency: params.defaultCurrency,
        lastSyncedAt: new Date(),
      }),
    );
  }

  /** Update capability flags for an existing account by Stripe account id. */
  async updateAccountCapabilities(params: {
    stripeAccountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  }): Promise<void> {
    await this.dataSource.query(
      `UPDATE "stripe_accounts"
       SET "charges_enabled" = $1, "payouts_enabled" = $2, "details_submitted" = $3,
           "last_synced_at" = NOW(), "updated_at" = NOW()
       WHERE "stripe_account_id" = $4`,
      [params.chargesEnabled, params.payoutsEnabled, params.detailsSubmitted, params.stripeAccountId],
    );
  }

  /** Find the account by Stripe account id (webhook dispatch). */
  async findAccountByStripeId(stripeAccountId: string): Promise<StripeAccount | null> {
    return this.dataSource.getRepository(StripeAccount).findOne({ where: { stripeAccountId } });
  }

  /** Find a payment by its payout Transfer id (transfer.* webhook dispatch). */
  async findPaymentByTransferId(stripeTransferId: string): Promise<Payment | null> {
    return this.dataSource.getRepository(Payment).findOne({ where: { stripeTransferId } });
  }

  /**
   * Find a payment via a SUCCEEDED attempt's charge id (charge/dispute dispatch).
   * The dispute/charge webhook object references the charge, not the payment.
   */
  async findPaymentByChargeId(stripeChargeId: string): Promise<Payment | null> {
    const rows = await this.dataSource.query<{ payment_id: string }[]>(
      `SELECT "payment_id" FROM "payment_attempts" WHERE "stripe_charge_id" = $1 LIMIT 1`,
      [stripeChargeId],
    );
    const paymentId = rows[0]?.payment_id;
    if (!paymentId) {
      return null;
    }
    return this.findPaymentById(paymentId);
  }

  // ─── Event ledger ──────────────────────────────────────────────────────────

  /**
   * Append a sanitized event to the ledger. Deduplicates on stripe_event_id (P8):
   * a redelivered webhook is silently ignored.
   */
  async appendEvent(params: AppendEventParams): Promise<void> {
    try {
      const repo = this.dataSource.getRepository(PaymentEvent);
      await repo.save(
        repo.create({
          paymentId: params.paymentId,
          source: params.source,
          eventType: params.eventType,
          stripeEventId: params.stripeEventId ?? null,
          idempotencyKey: params.idempotencyKey ?? null,
          amountCents: params.amountCents ?? null,
          currency: params.currency ?? null,
          payloadJson: params.payload as Record<string, unknown>,
        }),
      );
    } catch (error) {
      // Redelivered webhook (same stripe_event_id) — ignore.
      if (this.isUniqueViolation(error)) {
        return;
      }
      throw error;
    }
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private async lockPayment(manager: EntityManager, paymentId: string): Promise<PaymentRow> {
    const rows = await manager.query<PaymentRow[]>(
      `SELECT "id", "payment_status", "dispute_status", "payout_status",
              "platform_gross_revenue_cents", "net_platform_revenue_cents",
              "refunded_amount_cents", "reversed_amount_cents",
              "host_total_cents", "cleaner_payout_cents"
       FROM "payments" WHERE "id" = $1 FOR UPDATE`,
      [paymentId],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`Payment ${paymentId} not found`);
    }
    return row;
  }

  private async transitionPaymentStatus(
    manager: EntityManager,
    paymentId: string,
    target: PaymentStatus,
  ): Promise<void> {
    const payment = await this.lockPayment(manager, paymentId);
    this.assertPaymentTransition(payment.payment_status, target);
    await manager.query(
      `UPDATE "payments" SET "payment_status" = $1, "updated_at" = NOW() WHERE "id" = $2`,
      [target, paymentId],
    );
  }

  private assertPaymentTransition(current: string, target: PaymentStatus): void {
    const result = validatePaymentTransition(current as PaymentStatus, target);
    if (!result.valid) {
      throw new Error(result.reason ?? 'Invalid payment transition');
    }
  }

  private assertPayoutTransition(current: string, target: PayoutStatus): void {
    const result = validatePayoutTransition(current as PayoutStatus, target);
    if (!result.valid) {
      throw new Error(result.reason ?? 'Invalid payout transition');
    }
  }

  private assertDisputeTransition(current: string, target: DisputeStatus): void {
    const result = validateDisputeTransition(current as DisputeStatus, target);
    if (!result.valid) {
      throw new Error(result.reason ?? 'Invalid dispute transition');
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === PaymentsRepository.UNIQUE_VIOLATION
    );
  }
}

/** Raw locked payment row shape (snake_case columns). */
interface PaymentRow {
  readonly id: string;
  readonly payment_status: string;
  readonly dispute_status: string;
  readonly payout_status: string;
  readonly platform_gross_revenue_cents: number;
  readonly net_platform_revenue_cents: number;
  readonly refunded_amount_cents: number;
  readonly reversed_amount_cents: number;
  readonly host_total_cents: number;
  readonly cleaner_payout_cents: number;
}
