import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycAdminController } from './admin/kyc-admin.controller';
import { KycAdminService } from './admin/kyc-admin.service';
import { AiClientService } from './ai-client/ai-client.service';
import { KycStorageService } from './storage/kyc-storage.service';
import { KycStateTransitionService } from './state-machine/kyc-state-transition.service';
import { KycAuditService } from './kyc-audit.service';
import { KycProcessJob } from './jobs/kyc-process.job';
import { KycCleanupJob } from './jobs/kyc-cleanup.job';
import { KycVerification } from './entities/kyc-verification.entity';
import { KycAuditLog } from './entities/kyc-audit-log.entity';
import { User } from '../auth/entities/user.entity';

/**
 * KYC verification module.
 *
 * Handles identity verification for Cleaners:
 * document upload, selfie capture, AI processing,
 * admin review, and data retention/cleanup.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([KycVerification, KycAuditLog, User]),
    BullModule.registerQueue({ name: 'kyc-processing' }),
  ],
  controllers: [KycController, KycAdminController],
  providers: [
    KycService,
    KycAdminService,
    KycAuditService,
    AiClientService,
    KycStorageService,
    KycStateTransitionService,
    KycProcessJob,
    KycCleanupJob,
  ],
  exports: [KycService, KycStateTransitionService, KycAuditService],
})
export class KycModule {}
