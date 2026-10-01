import { BullModule } from '@nestjs/bullmq';
import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../auth/entities/user.entity';
import { ServiceOutboxConsumerCheckpoint } from '../service-tracking/service-outbox-consumer.checkpoint';
import { ServiceSessionRepository } from '../service-tracking/service-session.repository';
import { FaceVerifyClient } from './ai-client/face-verify.client';
import { validateVideoVerificationConfig } from './config/validate-video-verification-config';
import { VerificationArrivalConsumer } from './consumers/verification-arrival.consumer';
import { VerificationOutbox } from './entities/verification-outbox.entity';
import { VerificationSession } from './entities/verification-session.entity';
import { VideoVerificationObjectDeletion } from './entities/video-verification-object-deletion.entity';
import { VideoVerificationUploadGrant } from './entities/video-verification-upload-grant.entity';
import { FaceComparisonProcessor } from './jobs/face-comparison.processor';
import { RetentionCleanupProcessor } from './jobs/retention-cleanup.processor';
import { StuckProcessingSweep } from './jobs/stuck-processing-sweep.processor';
import { TombstoneDrainProcessor } from './jobs/tombstone-drain.processor';
import { UploadWindowSweep } from './jobs/upload-window-sweep.processor';
import { ObjectDeletionRepository } from './repository/object-deletion.repository';
import { UploadGrantRepository } from './repository/upload-grant.repository';
import { VerificationRepository } from './repository/verification.repository';
import { VerificationCreationService } from './service/verification-creation.service';
import { VerificationParticipationService } from './service/verification-participation.service';
import { VerificationService } from './service/verification.service';
import { KycReferenceReader } from './storage/kyc-reference-reader';
import { VerificationStorageService } from './storage/verification-storage.service';
import { VideoDurationProbe } from './storage/video-duration.probe';
import {
  VIDEO_VERIFICATION_COMPARISON_JOB_OPTIONS,
  VIDEO_VERIFICATION_COMPARISON_QUEUE_NAME,
} from './video-verification.constants';
import { VideoVerificationController } from './video-verification.controller';

/**
 * VideoVerificationModule (Spec 18).
 *
 * Owns the on-arrival identity check: creation off the durable `service_arrived` fact (drained via
 * the reused `ServiceOutboxConsumerCheckpoint` under `consumer_name='video'`), the single-winner
 * verification state machine, the grant-gated upload flow (key ≠ credential), the private
 * `verification-videos` MinIO bucket, the async best-effort DeepFace worker (Option A), the sweeps +
 * retention + tombstone-drain jobs, and the `verification_outbox` result events consumed by Spec 16.
 *
 * The comparison result is ADVISORY — never a hard gate on the service, escrow, or KYC. The reused
 * `ServiceOutboxConsumerCheckpoint` + `ServiceSessionRepository` are provided here (both depend only
 * on the global `DataSource`) so the module drains its own checkpoint without editing service-tracking.
 * Validates its config at startup (skipped under NODE_ENV=test).
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      VerificationSession,
      VideoVerificationUploadGrant,
      VideoVerificationObjectDeletion,
      VerificationOutbox,
      User,
    ]),
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: VIDEO_VERIFICATION_COMPARISON_QUEUE_NAME,
      defaultJobOptions: VIDEO_VERIFICATION_COMPARISON_JOB_OPTIONS,
    }),
  ],
  controllers: [VideoVerificationController],
  providers: [
    VerificationService,
    VerificationCreationService,
    VerificationParticipationService,
    VerificationRepository,
    UploadGrantRepository,
    ObjectDeletionRepository,
    VerificationStorageService,
    VideoDurationProbe,
    KycReferenceReader,
    FaceVerifyClient,
    VerificationArrivalConsumer,
    FaceComparisonProcessor,
    UploadWindowSweep,
    StuckProcessingSweep,
    RetentionCleanupProcessor,
    TombstoneDrainProcessor,
    // Reused from service-tracking (both depend only on the global DataSource) — the class is
    // reused, not duplicated, so this module drains its own 'video' checkpoint over service_outbox.
    ServiceOutboxConsumerCheckpoint,
    ServiceSessionRepository,
  ],
})
export class VideoVerificationModule implements OnModuleInit {
  onModuleInit(): void {
    validateVideoVerificationConfig();
  }
}
