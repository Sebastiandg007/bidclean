import { Injectable, Logger } from '@nestjs/common';
import { PaymentsRepository } from '../payments.repository';
import { PaymentPublisher } from '../events/payment-publisher.service';
import { DisputeStatus } from '../payments.types';
import { buildPaymentOutboxRow, PaymentOutboxEventType } from '../payment-outbox';

/**
 * Dispute service.
 *
 * Reacts to Stripe `charge.dispute.*` webhooks and drives the orthogonal
 * `dispute_status` (P12). Opening a dispute pauses auto-release (the auto-release
 * query excludes disputed payments, P5). A LOST dispute after payout is settled by
 * the future dispute-system using this module's Transfer Reversal primitive; here we
 * only track the state and react.
 */
@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly publisher: PaymentPublisher,
  ) {}

  /** Handle `charge.dispute.created`: set dispute_status = OPEN and emit payment.disputed. */
  async openDispute(paymentId: string): Promise<void> {
    const payment = await this.repo.findPaymentById(paymentId);
    if (!payment) {
      this.logger.warn(`Dispute for unknown payment ${paymentId} ignored`);
      return;
    }
    if (payment.disputeStatus === DisputeStatus.OPEN) {
      return; // idempotent
    }
    // Push Task 12: notify the Host that a dispute opened, atomically with the dispute_status write.
    await this.repo.setDisputeStatus(
      paymentId,
      DisputeStatus.OPEN,
      buildPaymentOutboxRow({
        paymentId,
        recipientUserId: payment.hostId,
        type: PaymentOutboxEventType.DISPUTED,
      }),
    );
    this.publisher.emitDisputed({
      paymentId,
      offerId: payment.offerId,
      hostId: payment.hostId,
      cleanerId: payment.cleanerId,
    });
    this.logger.log(`Dispute opened for payment ${paymentId} (auto-release paused)`);
  }

  /**
   * Platform-driven dispute block setter (dispute-system contract, Spec 21). Idempotently set the
   * escrow block (`OPEN`) or clear it (`NONE`). `setDisputeStatus(OPEN)` atomically wins against a
   * not-yet-accepted release on the payment aggregate (the guard lives under the row lock in
   * `markReleased`), so money is never released out from under an open BidClean dispute. `NONE` is
   * requested only AFTER Spec 9 has durably applied the resolution's financial action
   * (clear-escrow-LAST). This is the SAME `disputeStatus` guard the Stripe path uses, not a new
   * mechanism; it never touches money.
   */
  async setPlatformDisputeStatus(paymentId: string, open: boolean): Promise<void> {
    const payment = await this.repo.findPaymentById(paymentId);
    if (!payment) {
      this.logger.warn(`Platform dispute status for unknown payment ${paymentId} ignored`);
      return;
    }
    const target = open ? DisputeStatus.OPEN : DisputeStatus.NONE;
    if (payment.disputeStatus === target) {
      return; // idempotent
    }
    await this.repo.setDisputeStatus(paymentId, target);
    this.logger.log(`Platform dispute status set to ${target} for payment ${paymentId}`);
  }

  /** Handle `charge.dispute.closed`: set WON or LOST based on the dispute outcome. */
  async closeDispute(paymentId: string, won: boolean): Promise<void> {
    const payment = await this.repo.findPaymentById(paymentId);
    if (!payment) {
      this.logger.warn(`Dispute close for unknown payment ${paymentId} ignored`);
      return;
    }
    if (payment.disputeStatus !== DisputeStatus.OPEN) {
      return; // idempotent / out-of-order guard
    }
    await this.repo.setDisputeStatus(paymentId, won ? DisputeStatus.WON : DisputeStatus.LOST);
    this.logger.log(`Dispute ${won ? 'won' : 'lost'} for payment ${paymentId}`);
  }
}
