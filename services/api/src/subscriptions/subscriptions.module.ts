import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { User } from '../auth/entities/user.entity';
import { SUBSCRIPTION_TIER } from '../commission/contracts/subscription-tier.interface';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionEvent } from './entities/subscription-event.entity';
import { SubscriptionsController } from './subscriptions.controller';
import { RevenueCatWebhookController } from './webhooks/revenuecat-webhook.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { RealSubscriptionTierService } from './subscription-tier.service';
import { RevenueCatClient } from './revenuecat/revenuecat.client';
import { RevenueCatWebhookProcessor } from './webhooks/revenuecat-webhook.processor';
import { SubscriptionDispatchWorker } from './webhooks/subscription-dispatch.worker';
import { SubscriptionReconciliationService } from './reconciliation/subscription-reconciliation.service';
import {
  SUBSCRIPTION_DEFAULT_JOB_OPTIONS,
  SUBSCRIPTION_QUEUE_NAME,
  validateSubscriptionsConfig,
} from './subscriptions.constants';

/**
 * Subscriptions module (RevenueCat).
 *
 * The source of truth for a user's subscription tier. Binds the REAL `SUBSCRIPTION_TIER`
 * (replacing commission-system's stub) and EXPORTS it so `CommissionModule` can import this
 * module and consume the role-aware tier. Coupling is one-directional (Commission ->
 * Subscriptions): this module imports only the contract token from commission, never the
 * module, so there is no cycle. Registers the webhook BullMQ queue, the scheduled dispatch
 * recovery + reconciliation workers, and validates its configuration at startup (fail-fast).
 */
@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([Subscription, SubscriptionEvent, User]),
    BullModule.registerQueue({
      name: SUBSCRIPTION_QUEUE_NAME,
      defaultJobOptions: SUBSCRIPTION_DEFAULT_JOB_OPTIONS,
    }),
  ],
  controllers: [SubscriptionsController, RevenueCatWebhookController],
  providers: [
    SubscriptionsService,
    SubscriptionsRepository,
    RevenueCatClient,
    RevenueCatWebhookProcessor,
    SubscriptionDispatchWorker,
    SubscriptionReconciliationService,
    { provide: SUBSCRIPTION_TIER, useClass: RealSubscriptionTierService },
  ],
  exports: [SUBSCRIPTION_TIER],
})
export class SubscriptionsModule implements OnModuleInit {
  onModuleInit(): void {
    validateSubscriptionsConfig();
  }
}
