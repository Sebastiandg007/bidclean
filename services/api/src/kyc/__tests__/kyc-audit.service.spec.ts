import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KycAuditService, AuditAction } from '../kyc-audit.service';
import { KycAuditLog } from '../entities/kyc-audit-log.entity';
import { KycStatus } from '../kyc.types';

describe('KycAuditService', () => {
  let service: KycAuditService;
  let auditLogRepository: jest.Mocked<Partial<Repository<KycAuditLog>>>;

  const MOCK_VERIFICATION_ID = '11111111-1111-1111-1111-111111111111';
  const MOCK_ACTOR_ID = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    auditLogRepository = {
      create: jest.fn().mockImplementation((data) => data as KycAuditLog),
      save: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycAuditService,
        {
          provide: getRepositoryToken(KycAuditLog),
          useValue: auditLogRepository,
        },
      ],
    }).compile();

    service = module.get<KycAuditService>(KycAuditService);
  });

  describe('logStateTransition', () => {
    it('should create a STATE_TRANSITION audit log with actor', async () => {
      await service.logStateTransition({
        verificationId: MOCK_VERIFICATION_ID,
        actorId: MOCK_ACTOR_ID,
        oldStatus: KycStatus.NOT_STARTED,
        newStatus: KycStatus.DOCUMENT_UPLOADED,
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith({
        verificationId: MOCK_VERIFICATION_ID,
        action: AuditAction.STATE_TRANSITION,
        actorId: MOCK_ACTOR_ID,
        oldStatus: KycStatus.NOT_STARTED,
        newStatus: KycStatus.DOCUMENT_UPLOADED,
        metadata: null,
      });
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('should create a STATE_TRANSITION audit log with null actor for system events', async () => {
      await service.logStateTransition({
        verificationId: MOCK_VERIFICATION_ID,
        actorId: null,
        oldStatus: KycStatus.PROCESSING,
        newStatus: KycStatus.VERIFIED,
        metadata: { triggeredBy: 'kyc-processing-job' },
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith({
        verificationId: MOCK_VERIFICATION_ID,
        action: AuditAction.STATE_TRANSITION,
        actorId: null,
        oldStatus: KycStatus.PROCESSING,
        newStatus: KycStatus.VERIFIED,
        metadata: { triggeredBy: 'kyc-processing-job' },
      });
      expect(auditLogRepository.save).toHaveBeenCalled();
    });
  });

  describe('logDataAccess', () => {
    it('should create a DOCUMENT_VIEWED audit log', async () => {
      await service.logDataAccess({
        verificationId: MOCK_VERIFICATION_ID,
        actorId: MOCK_ACTOR_ID,
        action: AuditAction.DOCUMENT_VIEWED,
        metadata: { storageKey: 'kyc/user1/document/abc.jpg' },
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith({
        verificationId: MOCK_VERIFICATION_ID,
        action: AuditAction.DOCUMENT_VIEWED,
        actorId: MOCK_ACTOR_ID,
        oldStatus: null,
        newStatus: null,
        metadata: { storageKey: 'kyc/user1/document/abc.jpg' },
      });
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('should create a SELFIE_VIEWED audit log', async () => {
      await service.logDataAccess({
        verificationId: MOCK_VERIFICATION_ID,
        actorId: MOCK_ACTOR_ID,
        action: AuditAction.SELFIE_VIEWED,
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith({
        verificationId: MOCK_VERIFICATION_ID,
        action: AuditAction.SELFIE_VIEWED,
        actorId: MOCK_ACTOR_ID,
        oldStatus: null,
        newStatus: null,
        metadata: null,
      });
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('should create an OCR_VIEWED audit log', async () => {
      await service.logDataAccess({
        verificationId: MOCK_VERIFICATION_ID,
        actorId: MOCK_ACTOR_ID,
        action: AuditAction.OCR_VIEWED,
        metadata: { viewedFields: ['ocrConfidence', 'extractedName'] },
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith({
        verificationId: MOCK_VERIFICATION_ID,
        action: AuditAction.OCR_VIEWED,
        actorId: MOCK_ACTOR_ID,
        oldStatus: null,
        newStatus: null,
        metadata: { viewedFields: ['ocrConfidence', 'extractedName'] },
      });
      expect(auditLogRepository.save).toHaveBeenCalled();
    });
  });

  describe('logAdminDecision', () => {
    it('should create a VERIFICATION_APPROVED audit log', async () => {
      const metadata = {
        ocrConfidence: 0.95,
        faceSimilarityScore: 0.88,
        livenessScore: 0.92,
      };

      await service.logAdminDecision({
        verificationId: MOCK_VERIFICATION_ID,
        actorId: MOCK_ACTOR_ID,
        decision: AuditAction.VERIFICATION_APPROVED,
        oldStatus: KycStatus.PROCESSING,
        newStatus: KycStatus.VERIFIED,
        metadata,
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith({
        verificationId: MOCK_VERIFICATION_ID,
        action: AuditAction.VERIFICATION_APPROVED,
        actorId: MOCK_ACTOR_ID,
        oldStatus: KycStatus.PROCESSING,
        newStatus: KycStatus.VERIFIED,
        metadata,
      });
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('should create a VERIFICATION_REJECTED audit log with reason', async () => {
      const metadata = {
        ocrConfidence: 0.45,
        faceSimilarityScore: 0.30,
        livenessScore: 0.50,
        rejectionReason: 'Document unreadable',
      };

      await service.logAdminDecision({
        verificationId: MOCK_VERIFICATION_ID,
        actorId: MOCK_ACTOR_ID,
        decision: AuditAction.VERIFICATION_REJECTED,
        oldStatus: KycStatus.PROCESSING,
        newStatus: KycStatus.REJECTED,
        metadata,
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith({
        verificationId: MOCK_VERIFICATION_ID,
        action: AuditAction.VERIFICATION_REJECTED,
        actorId: MOCK_ACTOR_ID,
        oldStatus: KycStatus.PROCESSING,
        newStatus: KycStatus.REJECTED,
        metadata,
      });
      expect(auditLogRepository.save).toHaveBeenCalled();
    });
  });

  describe('logDeletion', () => {
    it('should create a DOCUMENT_DELETED audit log with null actorId', async () => {
      const metadata = {
        triggeredBy: 'kyc-cleanup-job',
        storageKey: 'kyc/user1/document/abc.jpg',
        retentionDays: 90,
      };

      await service.logDeletion({
        verificationId: MOCK_VERIFICATION_ID,
        action: AuditAction.DOCUMENT_DELETED,
        metadata,
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith({
        verificationId: MOCK_VERIFICATION_ID,
        action: AuditAction.DOCUMENT_DELETED,
        actorId: null,
        oldStatus: null,
        newStatus: null,
        metadata,
      });
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('should create a SELFIE_DELETED audit log', async () => {
      const metadata = {
        triggeredBy: 'kyc-cleanup-job',
        storageKey: 'kyc/user1/selfie/def.jpg',
        retentionDays: 90,
      };

      await service.logDeletion({
        verificationId: MOCK_VERIFICATION_ID,
        action: AuditAction.SELFIE_DELETED,
        metadata,
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith({
        verificationId: MOCK_VERIFICATION_ID,
        action: AuditAction.SELFIE_DELETED,
        actorId: null,
        oldStatus: null,
        newStatus: null,
        metadata,
      });
      expect(auditLogRepository.save).toHaveBeenCalled();
    });
  });

  describe('AuditAction enum', () => {
    it('should have all required actions', () => {
      expect(AuditAction.STATE_TRANSITION).toBe('STATE_TRANSITION');
      expect(AuditAction.DOCUMENT_VIEWED).toBe('DOCUMENT_VIEWED');
      expect(AuditAction.SELFIE_VIEWED).toBe('SELFIE_VIEWED');
      expect(AuditAction.OCR_VIEWED).toBe('OCR_VIEWED');
      expect(AuditAction.VERIFICATION_APPROVED).toBe('VERIFICATION_APPROVED');
      expect(AuditAction.VERIFICATION_REJECTED).toBe('VERIFICATION_REJECTED');
      expect(AuditAction.DOCUMENT_DELETED).toBe('DOCUMENT_DELETED');
      expect(AuditAction.SELFIE_DELETED).toBe('SELFIE_DELETED');
    });
  });
});
