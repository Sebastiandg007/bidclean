import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';
import { OffersRepository } from './offers.repository';
import { CommissionService } from './commission/commission.service';
import { CentrifugoClient } from './delivery/centrifugo.client';
import { DeliverySchedulerService } from './delivery/delivery-scheduler.service';
import { TierDeliveryProcessor } from './delivery/tier-delivery.processor';
import { FavoritesWindowProcessor } from './delivery/favorites-window.processor';
import { RadiusExpansionProcessor } from './expansion/radius-expansion.processor';
import { OfferNotificationService } from './notification/offer-notification.service';
import { OneSignalClient } from './notification/onesignal.client';
import { PushNotificationProcessor } from './notification/push-notification.processor';
import { OfferEventEmitterService } from './events/offer-event-emitter.service';
import { OfferStateMachineService } from './state-machine/offer-state-machine';
import { OfferOwnerGuard } from './guards/offer-owner.guard';
import { PropertyReadinessService } from './contracts/property-readiness.service';
import { PROPERTY_READINESS } from './contracts/property-readiness.interface';
import { OfferMatchService } from './contracts/offer-match.service';
import { OFFER_MATCH } from './contracts/offer-match.interface';
import { CleanerDiscoveryService } from './discovery/cleaner-discovery.service';
import { CLEANER_DISCOVERY } from './discovery/cleaner-discovery.interface';
import { OFFER_QUEUE_CONFIGS } from './queues/offer-queue.constants';
import { Offer } from './entities/offer.entity';
import { OfferStateTransition } from './entities/offer-state-transition.entity';
import { OfferDelivery } from './entities/offer-delivery.entity';
import { User } from '../auth/entities/user.entity';
import { AvailableOffersModule } from './available/available-offers.module';

/**
 * Offers module.
 *
 * Manages the full offer lifecycle: creation, publishing, progressive delivery
 * via tiered radius expansion, commission calculation, and state management.
 *
 * State machine: DRAFT → PUBLISHED → ACTIVE → MATCHED/COMPLETED/CANCELLED/EXPIRED
 *
 * Integrates with:
 * - BullMQ for radius expansion and tier delivery scheduling
 * - Centrifugo for real-time offer delivery to Cleaners
 * - OneSignal for push notification fallback
 * - PostGIS for geospatial Cleaner discovery
 * - Stripe Connect for escrow (downstream via domain events)
 */
@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot(),
    TypeOrmModule.forFeature([Offer, OfferStateTransition, OfferDelivery, User]),
    ...OFFER_QUEUE_CONFIGS.map((config) =>
      BullModule.registerQueue({
        name: config.name,
        defaultJobOptions: config.defaultJobOptions,
      }),
    ),
    AvailableOffersModule,
  ],
  controllers: [OffersController],
  providers: [
    OffersService,
    OffersRepository,
    CommissionService,
    CentrifugoClient,
    DeliverySchedulerService,
    TierDeliveryProcessor,
    FavoritesWindowProcessor,
    RadiusExpansionProcessor,
    OfferNotificationService,
    OneSignalClient,
    PushNotificationProcessor,
    OfferEventEmitterService,
    OfferStateMachineService,
    OfferOwnerGuard,
    {
      provide: PROPERTY_READINESS,
      useClass: PropertyReadinessService,
    },
    {
      provide: OFFER_MATCH,
      useClass: OfferMatchService,
    },
    {
      provide: CLEANER_DISCOVERY,
      useClass: CleanerDiscoveryService,
    },
  ],
  exports: [OffersService, CommissionService, OFFER_MATCH],
})
export class OffersModule {}
