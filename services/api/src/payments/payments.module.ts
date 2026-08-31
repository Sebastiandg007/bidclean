import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { OffersModule } from '../offers/offers.module';
import { User } from '../auth/entities/user.entity';
import { Offer } from '../offers/entities/offer.entity';
import { Payment } from './entities/payment.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { StripeAccount } from './entities/stripe-account.entity';
import { PaymentEvent } from './entities/payment-event.entity';
import { PaymentsController } from './payments.controller';
import { StripeWebhookController } from './webhooks/stripe-webhook.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { StripeClient } from './stripe/stripe.client';
import { PaymentPublisher } from './events/payment-publisher.service';
import { ConnectOnboardingService } from './connect/connect-onboarding.service';
import { ConnectReconciliationService } from './connect/connect-reconciliation.service';
import { EscrowChargeService } from './escrow/escrow-charge.service';
import { EscrowReleaseService } from './escrow/escrow-release.service';
import { RefundService } from './refunds/refund.service';
import { DisputeService } from './disputes/dispute.service';
import { OfferMatchedListener } from './listeners/offer-matched.listener';
import { AutoReleaseWorker } from './release/auto-release.worker';
import { PaymentReconciliationService } from './reconciliation/payment-reconciliation.service';
import { StripeWebhookProcessor } from './webhooks/stripe-webhook.processor';
import { PAYMENTS_DEFAULT_JOB_OPTIONS, PAYMENTS_QUEUE_NAMES, validatePaymentsConfig } from './payments.constants';

/**
 * Payments module (Stripe Escrow).
 *
 * Owns the charge/hold/release/refund lifecycle for matched offers. Imports
 * OffersModule to reuse CommissionService, subscribes to `offer.matched`, and emits
 * `payment.*` events — it NEVER writes the offers table. Registers the webhook +
 * deferred-release BullMQ queues, the scheduled workers, and reconciliation sweeps.
 * Validates its configuration at startup (fail-fast).
 */
@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([Payment, PaymentAttempt, StripeAccount, PaymentEvent, Offer, User]),
    BullModule.registerQueue(
      { name: PAYMENTS_QUEUE_NAMES.WEBHOOK, defaultJobOptions: PAYMENTS_DEFAULT_JOB_OPTIONS },
      { name: PAYMENTS_QUEUE_NAMES.DEFERRED_RELEASE, defaultJobOptions: PAYMENTS_DEFAULT_JOB_OPTIONS },
    ),
    OffersModule,
  ],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [
    PaymentsService,
    PaymentsRepository,
    StripeClient,
    PaymentPublisher,
    ConnectOnboardingService,
    ConnectReconciliationService,
    EscrowChargeService,
    EscrowReleaseService,
    RefundService,
    DisputeService,
    OfferMatchedListener,
    AutoReleaseWorker,
    PaymentReconciliationService,
    StripeWebhookProcessor,
  ],
  exports: [PaymentsService, EscrowReleaseService],
})
export class PaymentsModule implements OnModuleInit {
  onModuleInit(): void {
    validatePaymentsConfig();
  }
}
