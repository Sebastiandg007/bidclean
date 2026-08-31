import { Injectable, Logger } from '@nestjs/common';
import { PaymentsRepository } from '../payments.repository';
import { PaymentPublisher } from '../events/payment-publisher.service';
import { DisputeStatus } from '../payments.types';

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
    await this.repo.setDisputeStatus(paymentId, DisputeStatus.OPEN);
    this.publisher.emitDisputed({
      paymentId,
      offerId: payment.offerId,
      hostId: payment.hostId,
      cleanerId: payment.cleanerId,
    });
    this.logger.log(`Dispute opened for payment ${paymentId} (auto-release paused)`);
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
