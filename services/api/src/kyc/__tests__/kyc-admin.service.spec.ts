import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KycAdminService } from '../admin/kyc-admin.service';
import { KycVerification } from '../entities/kyc-verification.entity';

describe('KycAdminService', () => {
  let service: KycAdminService;

  const mockRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycAdminService,
        {
          provide: getRepositoryToken(KycVerification),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<KycAdminService>(KycAdminService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // TODO: Add tests for getReviewQueue, getVerificationDetail, makeDecision
  // These will be implemented when the service methods are fully built out
});
