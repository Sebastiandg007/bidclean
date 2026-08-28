import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentsRepository } from './payments.repository';
import { ConnectOnboardingService } from './connect/connect-onboarding.service';
import { RefundService, RefundRequest } from './refunds/refund.service';
import { toPaymentView } from './payments.mapper';
import { PaymentView, StripeAccountStatus } from './payments.types';

/**
 * Payments orchestration facade.
 *
 * Thin coordinator the controller depends on. Delegates onboarding to
 * ConnectOnboardingService and refunds to RefundService; owns the read-path
 * authorization for a payment (Host owner or matched Cleaner only, P10).
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly repo: PaymentsRepository,
    private readonly onboarding: ConnectOnboardingService,
    private readonly refunds: RefundService,
  ) {}

  /** Start (or resume) Cleaner payout onboarding. */
  startCleanerOnboarding(cleanerId: string): Promise<{ onboardingUrl: string }> {
    return this.onboarding.startOnboarding(cleanerId);
  }

  /** Get the Cleaner's account capability status. */
  getCleanerAccountStatus(cleanerId: string): Promise<StripeAccountStatus> {
    return this.onboarding.getAccountStatus(cleanerId);
  }

  /**
   * Get the payment for an offer, authorized to the Host owner or the matched Cleaner
   * only (P10).
   */
  async getPaymentForOffer(userId: string, offerId: string): Promise<PaymentView> {
    const payment = await this.repo.findPaymentByOffer(offerId);
    if (!payment) {
      throw new NotFoundException(`No payment found for offer ${offerId}`);
    }
    if (payment.hostId !== userId && payment.cleanerId !== userId) {
      throw new ForbiddenException('Not authorized to view this payment');
    }
    return toPaymentView(payment);
  }

  /** Refund a payment (delegates to the refund service with policy enforcement). */
  refund(
    hostId: string,
    offerId: string,
    request: RefundRequest,
    idempotencyKey: string,
  ): Promise<PaymentView> {
    return this.refunds.refund(hostId, offerId, request, idempotencyKey);
  }
}
