import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../auth/entities/user.entity';
import { PaymentsModule } from '../payments/payments.module';
import {
  SERVICE_COMPLETION_JOB_OPTIONS,
  SERVICE_COMPLETION_QUEUE_NAME,
  validateServiceCompletionConfig,
} from './completion.constants';
import { CompletionController } from './completion.controller';
import { CompletionOutbox } from './entities/completion-outbox.entity';
import { ReleaseIntent } from './entities/release-intent.entity';
import { ServiceCompletion } from './entities/service-completion.entity';
import { ServiceRating } from './entities/service-rating.entity';
import { ChecklistOutboxConsumerCheckpoint } from './repository/checklist-outbox-consumer.checkpoint';
import { CompletionRepository } from './repository/completion.repository';
import { ReleaseIntentRepository } from './repository/release-intent.repository';
import { ServiceRatingRepository } from './repository/service-rating.repository';
import { CompletionParticipationService } from './service/completion-participation.service';
import { CompletionCreationService } from './service/completion-creation.service';
import { CompletionDecisionService } from './service/completion-decision.service';
import { AutoReleaseService } from './service/auto-release.service';
import { RatingService } from './service/rating.service';
import { CompletionViewService } from './service/completion-view.service';
import { CompletionCreatedConsumer } from './consumers/completion-created.consumer';
import { AutoReleaseSweepProcessor } from './jobs/auto-release-sweep.processor';
import { ReleaseIntentWorker } from './jobs/release-intent.worker';

/**
 * ServiceCompletionModule (Spec 20 — the last of Sprint 5, Service Execution).
 *
 * Closes the service loop: consumes checklist-photos' durable `checklist_completed` event via its
 * OWN per-consumer checkpoint (`consumer_name = 'completion'`), creates the completion idempotently,
 * and owns the single-winner confirm/auto-release/dispute DECISION. Every release-bearing decision
 * commits a durable `release_intent` in the same tx; the `ReleaseIntentWorker` drains it into
 * Spec 9's single-winner `EscrowReleaseService.release` (imported via `PaymentsModule`) — the ONLY
 * path that touches money, with idempotent retries + lease-based crash recovery. Captures ratings
 * (never gating). Reuses the shared Redis/BullMQ + ScheduleModule. Validates its config at startup
 * (fail-fast, skipped under NODE_ENV=test).
 */
@Module({
  imports: [
    ConfigModule,
    PaymentsModule,
    TypeOrmModule.forFeature([ServiceCompletion, ReleaseIntent, ServiceRating, CompletionOutbox, User]),
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: SERVICE_COMPLETION_QUEUE_NAME,
      defaultJobOptions: SERVICE_COMPLETION_JOB_OPTIONS,
    }),
  ],
  controllers: [CompletionController],
  providers: [
    // Services
    CompletionParticipationService,
    CompletionCreationService,
    CompletionDecisionService,
    AutoReleaseService,
    RatingService,
    CompletionViewService,
    // Repositories + checkpoint (its own checkpoint over checklist_outbox)
    CompletionRepository,
    ReleaseIntentRepository,
    ServiceRatingRepository,
    ChecklistOutboxConsumerCheckpoint,
    // Consumer + jobs
    CompletionCreatedConsumer,
    AutoReleaseSweepProcessor,
    ReleaseIntentWorker,
  ],
})
export class ServiceCompletionModule implements OnModuleInit {
  onModuleInit(): void {
    validateServiceCompletionConfig();
  }
}
