import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../auth/entities/user.entity';
import { PaymentsModule } from '../payments/payments.module';
import { validateDisputeConfig } from './config/validate-dispute-config';
import { DISPUTE_JOB_OPTIONS, DISPUTE_QUEUE_NAME } from './dispute.constants';
import { DisputeController } from './dispute.controller';
import { Dispute } from './entities/dispute.entity';
import { DisputeEscrowIntent } from './entities/dispute-escrow-intent.entity';
import { DisputeEvidence } from './entities/dispute-evidence.entity';
import { DisputeFinancialIntent } from './entities/dispute-financial-intent.entity';
import { DisputeObjectDeletion } from './entities/dispute-object-deletion.entity';
import { DisputeOutbox } from './entities/dispute-outbox.entity';
import { DisputeUploadGrant } from './entities/dispute-upload-grant.entity';
import { EscrowClient } from './escrow/escrow.client';
import { UpstreamEvidenceReader } from './evidence/upstream-evidence.reader';
import { DisputeCreatedConsumer } from './consumers/dispute-created.consumer';
import { EscrowIntentWorker } from './jobs/escrow-intent.worker';
import { FinancialIntentWorker } from './jobs/financial-intent.worker';
import { DisputeSlaSweepProcessor } from './jobs/dispute-sla-sweep.processor';
import { EvidenceRetentionProcessor } from './jobs/evidence-retention.processor';
import { TombstoneDrainProcessor } from './jobs/tombstone-drain.processor';
import { StaleGrantCleanupProcessor } from './jobs/stale-grant-cleanup.processor';
import { CompletionOutboxConsumerCheckpoint } from './repository/completion-outbox-consumer.checkpoint';
import { DisputeRepository } from './repository/dispute.repository';
import { DisputeEscrowIntentRepository } from './repository/dispute-escrow-intent.repository';
import { DisputeEvidenceRepository } from './repository/dispute-evidence.repository';
import { DisputeFinancialIntentRepository } from './repository/dispute-financial-intent.repository';
import { DisputeObjectDeletionRepository } from './repository/dispute-object-deletion.repository';
import { DisputeUploadGrantRepository } from './repository/dispute-upload-grant.repository';
import { DisputeCreationService } from './service/dispute-creation.service';
import { DisputeEvidenceService } from './service/dispute-evidence.service';
import { DisputeLifecycleService } from './service/dispute-lifecycle.service';
import { DisputeParticipationService } from './service/dispute-participation.service';
import { DisputeResolutionService } from './service/dispute-resolution.service';
import { DisputeSlaService } from './service/dispute-sla.service';
import { DisputeViewService } from './service/dispute-view.service';
import { DisputeEvidenceStorageService } from './storage/dispute-evidence-storage.service';

/**
 * DisputeSystemModule (Spec 21 — the first of Sprint 6, Polish & Extras).
 *
 * Owns the dispute CASE + its resolution; never the money ledger. It consumes service-completion's
 * durable `service_disputed` event via its OWN per-consumer checkpoint (`consumer_name = 'dispute'`),
 * creates the dispute idempotently, and drives every money-bearing transition through durable intents
 * (escrow-block + financial) drained by lease-based workers into Spec 9 (imported via `PaymentsModule`
 * — the ONLY money seam, via the mockable `EscrowClient`; NO Stripe keys, NO Stripe SDK here). Clears
 * the escrow LAST. Reuses the shared Redis/BullMQ + ScheduleModule. Validates its config at startup
 * (fail-fast, skipped under NODE_ENV=test).
 */
@Module({
  imports: [
    ConfigModule,
    PaymentsModule,
    TypeOrmModule.forFeature([
      Dispute,
      DisputeEvidence,
      DisputeEscrowIntent,
      DisputeFinancialIntent,
      DisputeUploadGrant,
      DisputeObjectDeletion,
      DisputeOutbox,
      User,
    ]),
    ScheduleModule.forRoot(),
    BullModule.registerQueue({ name: DISPUTE_QUEUE_NAME, defaultJobOptions: DISPUTE_JOB_OPTIONS }),
  ],
  controllers: [DisputeController],
  providers: [
    // Services
    DisputeParticipationService,
    DisputeCreationService,
    DisputeLifecycleService,
    DisputeResolutionService,
    DisputeSlaService,
    DisputeEvidenceService,
    DisputeViewService,
    // Seams
    EscrowClient,
    UpstreamEvidenceReader,
    DisputeEvidenceStorageService,
    // Repositories + checkpoint (its own checkpoint over completion_outbox)
    DisputeRepository,
    DisputeEscrowIntentRepository,
    DisputeFinancialIntentRepository,
    DisputeEvidenceRepository,
    DisputeUploadGrantRepository,
    DisputeObjectDeletionRepository,
    CompletionOutboxConsumerCheckpoint,
    // Consumer + workers + cleanup jobs
    DisputeCreatedConsumer,
    EscrowIntentWorker,
    FinancialIntentWorker,
    DisputeSlaSweepProcessor,
    EvidenceRetentionProcessor,
    TombstoneDrainProcessor,
    StaleGrantCleanupProcessor,
  ],
})
export class DisputeSystemModule implements OnModuleInit {
  onModuleInit(): void {
    validateDisputeConfig();
  }
}
