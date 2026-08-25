import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';
import { OffersRepository } from './offers.repository';
import { CommissionService } from './commission/commission.service';
import { DeliverySchedulerService } from './delivery/delivery-scheduler.service';
import { OfferNotificationService } from './notification/offer-notification.service';
import { OfferEventEmitterService } from './events/offer-event-emitter.service';
import { OfferOwnerGuard } from './guards/offer-owner.guard';
import { PropertyReadinessService } from './contracts/property-readiness.service';
import { PROPERTY_READINESS } from './contracts/property-readiness.interface';
import { Offer } from './entities/offer.entity';
import { OfferStateTransition } from './entities/offer-state-transition.entity';
import { OfferDelivery } from './entities/offer-delivery.entity';

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
    TypeOrmModule.forFeature([Offer, OfferStateTransition, OfferDelivery]),
  ],
  controllers: [OffersController],
  providers: [
    OffersService,
    OffersRepository,
    CommissionService,
    DeliverySchedulerService,
    OfferNotificationService,
    OfferEventEmitterService,
    OfferOwnerGuard,
    {
      provide: PROPERTY_READINESS,
      useClass: PropertyReadinessService,
    },
  ],
  exports: [OffersService, CommissionService],
})
export class OffersModule {}
