import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../auth/entities/user.entity';
import { CentrifugoClient } from '../offers/delivery/centrifugo.client';
import { OffersModule } from '../offers/offers.module';
import { ServiceSession } from './entities/service-session.entity';
import { ServiceOutbox } from './entities/service-outbox.entity';
import { ServiceOutboxConsumer } from './entities/service-outbox-consumer.entity';
import { ServiceActivationConsumed } from './entities/service-activation-consumed.entity';
import { GeofenceService } from './geofence.service';
import { PositionRateLimiter } from './position-rate-limiter';
import { ServiceSessionParticipationService } from './service-session-participation.service';
import { ServiceSessionRepository } from './service-session.repository';
import {
  ServiceSessionService,
  SERVICE_REALTIME_PUBLISHER,
} from './service-session.service';
import { ServiceSessionController } from './service-session.controller';
import { ServiceActivationConsumer } from './service-activation.consumer';
import { ServiceOutboxConsumerCheckpoint } from './service-outbox-consumer.checkpoint';
import { OfferTerminalSessionListener } from './offer-terminal-session.listener';
import { ServiceSweepProcessor } from './service-sweep.processor';
import {
  SERVICE_SWEEP_JOB_OPTIONS,
  SERVICE_SWEEP_QUEUE_NAME,
  validateServiceTrackingConfig,
} from './service-tracking.constants';

/**
 * ServiceTrackingModule (Spec 17).
 *
 * Owns the post-match, pre-work execution lifecycle: session creation off the durable
 * `service_activation_ready` fact, the single-winner state machine, the server-authoritative
 * geofence (Option A position ingress), the `service_outbox` fan-out, and the bounded sweep. Reuses
 * the existing `CentrifugoClient` (exported by `OffersModule`) bound to the `SERVICE_REALTIME_PUBLISHER`
 * seam, and the shared Redis/BullMQ + ScheduleModule. EXPORTS `ServiceSessionParticipationService`
 * so the auth Centrifugo token endpoint can authorize `service:session:{id}` subscriptions (auth
 * owns tokens, service-tracking owns the participation rule). Validates its config at startup.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      ServiceSession,
      ServiceOutbox,
      ServiceOutboxConsumer,
      ServiceActivationConsumed,
      User,
    ]),
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: SERVICE_SWEEP_QUEUE_NAME,
      defaultJobOptions: SERVICE_SWEEP_JOB_OPTIONS,
    }),
    OffersModule,
  ],
  controllers: [ServiceSessionController],
  providers: [
    ServiceSessionService,
    ServiceSessionRepository,
    GeofenceService,
    PositionRateLimiter,
    ServiceSessionParticipationService,
    ServiceActivationConsumer,
    ServiceOutboxConsumerCheckpoint,
    OfferTerminalSessionListener,
    ServiceSweepProcessor,
    { provide: SERVICE_REALTIME_PUBLISHER, useExisting: CentrifugoClient },
  ],
  exports: [ServiceSessionParticipationService],
})
export class ServiceTrackingModule implements OnModuleInit {
  onModuleInit(): void {
    validateServiceTrackingConfig();
  }
}
