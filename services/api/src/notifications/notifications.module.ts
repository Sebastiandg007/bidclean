import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { User } from '../auth/entities/user.entity';
import { NotificationDevice } from './entities/notification-device.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { Notification } from './entities/notification.entity';
import { OnesignalWebhookEvent } from './entities/onesignal-webhook-event.entity';
import {
  OfferOutbox,
  PaymentOutbox,
  NegotiationOutbox,
  ChatOutbox,
  VoipOutbox,
} from './entities/outbox.entity';
import { NotificationsRepository } from './notifications.repository';
import { NotificationTypeRegistry } from './notification-type.registry';
import { NotificationContentCatalog } from './notification-content.catalog';
import { PreferenceService } from './preference.service';
import { DeviceRegistryService } from './device-registry.service';
import { NotificationService } from './notification.service';
import { OneSignalClient } from './onesignal/onesignal.client';
import { OutboxRelayProcessor } from './outbox-relay.processor';
import { DeliveryWorker } from './delivery.worker';
import { ReconcileSweepProcessor } from './reconcile-sweep.processor';
import { OfferOutboxMapper } from './mappers/offer-outbox.mapper';
import { PaymentOutboxMapper } from './mappers/payment-outbox.mapper';
import { NegotiationOutboxMapper } from './mappers/negotiation-outbox.mapper';
import { ChatOutboxMapper } from './mappers/chat-outbox.mapper';
import { VoipOutboxMapper } from './mappers/voip-outbox.mapper';
import { NotificationDeviceController } from './notification-device.controller';
import { NotificationPreferenceController } from './notification-preference.controller';
import { OneSignalWebhookController } from './webhooks/onesignal-webhook.controller';
import {
  NOTIFICATIONS_DELIVERY_JOB_OPTIONS,
  NOTIFICATIONS_QUEUE_NAMES,
  validateNotificationsConfig,
} from './notifications.constants';

/**
 * Notifications module (Spec 16).
 *
 * The dedicated, first-class notification system: device/subscription registry, notification ledger
 * + dedup/idempotency, the durable-outbox relay + per-domain mappers, the localized content catalog,
 * preferences/quiet-hours, the BullMQ delivery worker, the OneSignal webhook ingress, and the
 * registry <-> OneSignal reconciliation sweep. It REACTS to committed outbox rows; it is never a
 * source of business truth and no business transaction depends on a push succeeding. Holds the
 * generalized `OneSignalClient` (moved from `offers`). Config is validated fail-fast at startup.
 */
@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      User,
      NotificationDevice,
      NotificationPreference,
      Notification,
      OnesignalWebhookEvent,
      OfferOutbox,
      PaymentOutbox,
      NegotiationOutbox,
      ChatOutbox,
      VoipOutbox,
    ]),
    BullModule.registerQueue({
      name: NOTIFICATIONS_QUEUE_NAMES.DELIVERY,
      defaultJobOptions: NOTIFICATIONS_DELIVERY_JOB_OPTIONS,
    }),
  ],
  controllers: [
    NotificationDeviceController,
    NotificationPreferenceController,
    OneSignalWebhookController,
  ],
  providers: [
    NotificationsRepository,
    NotificationTypeRegistry,
    NotificationContentCatalog,
    PreferenceService,
    DeviceRegistryService,
    NotificationService,
    OneSignalClient,
    OutboxRelayProcessor,
    DeliveryWorker,
    ReconcileSweepProcessor,
    OfferOutboxMapper,
    PaymentOutboxMapper,
    NegotiationOutboxMapper,
    ChatOutboxMapper,
    VoipOutboxMapper,
  ],
  exports: [NotificationService, DeviceRegistryService],
})
export class NotificationsModule implements OnModuleInit {
  onModuleInit(): void {
    validateNotificationsConfig();
  }
}
