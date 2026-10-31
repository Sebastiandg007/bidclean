import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../auth/entities/user.entity';
import { ServiceSessionRepository } from '../service-tracking/service-session.repository';
import { ServiceOutboxConsumerCheckpoint } from '../service-tracking/service-outbox-consumer.checkpoint';
import {
  CHECKLIST_CLEANUP_JOB_OPTIONS,
  CHECKLIST_CLEANUP_QUEUE_NAME,
  validateChecklistPhotosConfig,
} from './checklist.constants';
import { ChecklistController } from './checklist.controller';
import { ChecklistOutbox } from './entities/checklist-outbox.entity';
import { ChecklistPhotoObjectDeletion } from './entities/checklist-photo-object-deletion.entity';
import { ChecklistRun } from './entities/checklist-run.entity';
import { ChecklistTask } from './entities/checklist-task.entity';
import { ChecklistTaskPhoto } from './entities/checklist-task-photo.entity';
import { ChecklistUploadGrant } from './entities/checklist-upload-grant.entity';
import { ChecklistObjectDeletionRepository } from './repository/checklist-object-deletion.repository';
import { ChecklistRepository } from './repository/checklist.repository';
import { ChecklistUploadGrantRepository } from './repository/checklist-upload-grant.repository';
import { ChecklistParticipationService } from './service/checklist-participation.service';
import { ChecklistPhotoService } from './service/checklist-photo.service';
import { ChecklistRunCreationService } from './service/checklist-run-creation.service';
import { ChecklistRunService } from './service/checklist-run.service';
import { ChecklistTaskService } from './service/checklist-task.service';
import { ChecklistStorageService } from './storage/checklist-storage.service';
import { ChecklistStartedConsumer } from './consumers/checklist-started.consumer';
import { OfferTerminalChecklistListener } from './listeners/offer-terminal-checklist.listener';
import { RetentionCleanupProcessor } from './jobs/retention-cleanup.processor';
import { StaleUploadGrantCleanupProcessor } from './jobs/stale-upload-grant-cleanup.processor';
import { StuckRunSweep } from './jobs/stuck-run-sweep.processor';
import { TombstoneDrainProcessor } from './jobs/tombstone-drain.processor';

/**
 * ChecklistPhotosModule (Spec 19 — Service Execution).
 *
 * Records the work itself while a session is IN_PROGRESS: it consumes service-tracking's durable
 * `service_started` event via its OWN per-consumer checkpoint (`consumer_name = 'checklist'`,
 * reusing Spec 17's `ServiceOutboxConsumerCheckpoint`, never duplicated), snapshots the property
 * checklist + policies onto a run, drives the count-invariant task marking + grant-gated evidence
 * flow (bytes only in a private MinIO bucket), and emits `checklist_completed` for Spec 20/21 to
 * settle on. Reuses the shared Redis/BullMQ + ScheduleModule. Validates its config at startup
 * (fail-fast, skipped under NODE_ENV=test).
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      ChecklistRun,
      ChecklistTask,
      ChecklistTaskPhoto,
      ChecklistUploadGrant,
      ChecklistPhotoObjectDeletion,
      ChecklistOutbox,
      User,
    ]),
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: CHECKLIST_CLEANUP_QUEUE_NAME,
      defaultJobOptions: CHECKLIST_CLEANUP_JOB_OPTIONS,
    }),
  ],
  controllers: [ChecklistController],
  providers: [
    // Services
    ChecklistParticipationService,
    ChecklistRunCreationService,
    ChecklistTaskService,
    ChecklistPhotoService,
    ChecklistRunService,
    ChecklistStorageService,
    // Repositories
    ChecklistRepository,
    ChecklistUploadGrantRepository,
    ChecklistObjectDeletionRepository,
    // Consumer + listener (reuse Spec 17's checkpoint over service_outbox)
    ChecklistStartedConsumer,
    OfferTerminalChecklistListener,
    ServiceOutboxConsumerCheckpoint,
    ServiceSessionRepository,
    // Cleanup / sweep jobs
    RetentionCleanupProcessor,
    TombstoneDrainProcessor,
    StaleUploadGrantCleanupProcessor,
    StuckRunSweep,
  ],
})
export class ChecklistPhotosModule implements OnModuleInit {
  onModuleInit(): void {
    validateChecklistPhotosConfig();
  }
}
