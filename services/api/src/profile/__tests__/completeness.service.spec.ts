import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CompletenessService } from '../completeness/completeness.service';
import { CompletenessWeightValidator } from '../completeness/completeness-weight.validator';
import { ProfileRepository } from '../profile.repository';
import { PortfolioService } from '../portfolio/portfolio.service';
import { HostProfile } from '../../roles/entities/host-profile.entity';
import { CleanerProfile } from '../../roles/entities/cleaner-profile.entity';
import { ProfileDetails } from '../entities/profile-details.entity';
import { KycStatus } from '../../kyc/kyc.types';

const HOST_WEIGHTS = 'name:25,photo:25,business_name:20,payment_method:15,first_property:15';
const CLEANER_WEIGHTS = 'name:15,photo:15,specialties:15,work_zone:15,availability:10,portfolio:10,kyc:10,bio:10';

const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('CompletenessService', () => {
  let service: CompletenessService;
  let profileRepository: jest.Mocked<ProfileRepository>;
  let portfolioService: jest.Mocked<PortfolioService>;
  let hostProfileRepo: jest.Mocked<Repository<HostProfile>>;
  let cleanerProfileRepo: jest.Mocked<Repository<CleanerProfile>>;
  let dataSource: jest.Mocked<DataSource>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompletenessService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              const config: Record<string, string> = {
                PROFILE_COMPLETENESS_WEIGHTS_HOST: HOST_WEIGHTS,
                PROFILE_COMPLETENESS_WEIGHTS_CLEANER: CLEANER_WEIGHTS,
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: CompletenessWeightValidator,
          useValue: { validateWeights: jest.fn() },
        },
        {
          provide: ProfileRepository,
          useValue: { findByUserId: jest.fn() },
        },
        {
          provide: PortfolioService,
          useValue: { getPhotoCount: jest.fn() },
        },
        {
          provide: getRepositoryToken(HostProfile),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(CleanerProfile),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: { query: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<CompletenessService>(CompletenessService);
    profileRepository = module.get(ProfileRepository);
    portfolioService = module.get(PortfolioService);
    hostProfileRepo = module.get(getRepositoryToken(HostProfile));
    cleanerProfileRepo = module.get(getRepositoryToken(CleanerProfile));
    dataSource = module.get(DataSource);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should validate weights on boot', () => {
      const validator = { validateWeights: jest.fn() } as unknown as CompletenessWeightValidator;
      const svc = new CompletenessService(
        configService,
        validator,
        profileRepository,
        portfolioService,
        hostProfileRepo as unknown as Repository<HostProfile>,
        cleanerProfileRepo as unknown as Repository<CleanerProfile>,
        dataSource,
      );

      svc.onModuleInit();

      expect(validator.validateWeights).toHaveBeenCalledTimes(1);
    });
  });

  describe('calculateCompleteness — Host', () => {
    it('should return 0% when no fields are completed', async () => {
      profileRepository.findByUserId.mockResolvedValue(null);
      hostProfileRepo.findOne.mockResolvedValue(null);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'host');

      expect(result.percentage).toBe(0);
      expect(result.role).toBe('host');
      expect(result.fields).toHaveLength(5);
      expect(result.fields.every((f) => !f.completed)).toBe(true);
    });

    it('should calculate host completeness when name and photo are completed', async () => {
      profileRepository.findByUserId.mockResolvedValue({
        displayName: 'John Doe',
        photoStorageKey: 'users/photo.jpg',
        bio: null,
      } as ProfileDetails);
      hostProfileRepo.findOne.mockResolvedValue(null);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'host');

      // name:25 + photo:25 = 50
      expect(result.percentage).toBe(50);
      expect(result.fields.find((f) => f.name === 'name')?.completed).toBe(true);
      expect(result.fields.find((f) => f.name === 'photo')?.completed).toBe(true);
      expect(result.fields.find((f) => f.name === 'business_name')?.completed).toBe(false);
    });

    it('should calculate full host completeness except first_property', async () => {
      profileRepository.findByUserId.mockResolvedValue({
        displayName: 'John Doe',
        photoStorageKey: 'users/photo.jpg',
        bio: null,
      } as ProfileDetails);
      hostProfileRepo.findOne.mockResolvedValue({
        businessName: 'CleanCo LLC',
        paymentMethodAdded: true,
      } as HostProfile);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'host');

      // name:25 + photo:25 + business_name:20 + payment_method:15 = 85
      expect(result.percentage).toBe(85);
      expect(result.fields.find((f) => f.name === 'first_property')?.completed).toBe(false);
    });

    it('should handle case-insensitive role input', async () => {
      profileRepository.findByUserId.mockResolvedValue(null);
      hostProfileRepo.findOne.mockResolvedValue(null);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'HOST');

      expect(result.role).toBe('host');
      expect(result.fields).toHaveLength(5);
    });

    it('should not mark name as completed for whitespace-only string', async () => {
      profileRepository.findByUserId.mockResolvedValue({
        displayName: '   ',
        photoStorageKey: null,
        bio: null,
      } as ProfileDetails);
      hostProfileRepo.findOne.mockResolvedValue(null);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'host');

      expect(result.fields.find((f) => f.name === 'name')?.completed).toBe(false);
    });

    it('should not mark business_name as completed for whitespace-only string', async () => {
      profileRepository.findByUserId.mockResolvedValue(null);
      hostProfileRepo.findOne.mockResolvedValue({
        businessName: '  ',
        paymentMethodAdded: false,
      } as HostProfile);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'host');

      expect(result.fields.find((f) => f.name === 'business_name')?.completed).toBe(false);
    });
  });

  describe('calculateCompleteness — Cleaner', () => {
    it('should return 0% when no fields are completed', async () => {
      profileRepository.findByUserId.mockResolvedValue(null);
      cleanerProfileRepo.findOne.mockResolvedValue(null);
      portfolioService.getPhotoCount.mockResolvedValue(0);
      dataSource.query.mockResolvedValue([]);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'cleaner');

      expect(result.percentage).toBe(0);
      expect(result.role).toBe('cleaner');
      expect(result.fields).toHaveLength(8);
      expect(result.fields.every((f) => !f.completed)).toBe(true);
    });

    it('should calculate cleaner completeness with all fields completed', async () => {
      profileRepository.findByUserId.mockResolvedValue({
        displayName: 'Maria Garcia',
        photoStorageKey: 'users/maria.jpg',
        bio: 'Professional cleaner with 5 years of experience',
      } as ProfileDetails);
      cleanerProfileRepo.findOne.mockResolvedValue({
        specialties: ['airbnb', 'offices'],
        workZoneLat: 4.7110,
        workZoneLng: -74.0721,
        availability: {
          monday: { enabled: true, start: '08:00', end: '17:00' },
          tuesday: { enabled: false, start: null, end: null },
        },
      } as unknown as CleanerProfile);
      portfolioService.getPhotoCount.mockResolvedValue(3);
      dataSource.query.mockResolvedValue([{ status: KycStatus.VERIFIED }]);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'cleaner');

      expect(result.percentage).toBe(100);
      expect(result.fields.every((f) => f.completed)).toBe(true);
    });

    it('should derive portfolio completeness from COUNT(*) greater than 0', async () => {
      profileRepository.findByUserId.mockResolvedValue(null);
      cleanerProfileRepo.findOne.mockResolvedValue(null);
      portfolioService.getPhotoCount.mockResolvedValue(5);
      dataSource.query.mockResolvedValue([]);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'cleaner');

      expect(result.fields.find((f) => f.name === 'portfolio')?.completed).toBe(true);
    });

    it('should mark portfolio as incomplete when count is 0', async () => {
      profileRepository.findByUserId.mockResolvedValue(null);
      cleanerProfileRepo.findOne.mockResolvedValue(null);
      portfolioService.getPhotoCount.mockResolvedValue(0);
      dataSource.query.mockResolvedValue([]);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'cleaner');

      expect(result.fields.find((f) => f.name === 'portfolio')?.completed).toBe(false);
    });

    it('should mark kyc as completed only when status is VERIFIED', async () => {
      profileRepository.findByUserId.mockResolvedValue(null);
      cleanerProfileRepo.findOne.mockResolvedValue(null);
      portfolioService.getPhotoCount.mockResolvedValue(0);
      dataSource.query.mockResolvedValue([{ status: KycStatus.VERIFIED }]);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'cleaner');

      expect(result.fields.find((f) => f.name === 'kyc')?.completed).toBe(true);
    });

    it('should mark kyc as incomplete when status is PROCESSING', async () => {
      profileRepository.findByUserId.mockResolvedValue(null);
      cleanerProfileRepo.findOne.mockResolvedValue(null);
      portfolioService.getPhotoCount.mockResolvedValue(0);
      dataSource.query.mockResolvedValue([{ status: KycStatus.PROCESSING }]);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'cleaner');

      expect(result.fields.find((f) => f.name === 'kyc')?.completed).toBe(false);
    });

    it('should mark kyc as incomplete when no verification exists', async () => {
      profileRepository.findByUserId.mockResolvedValue(null);
      cleanerProfileRepo.findOne.mockResolvedValue(null);
      portfolioService.getPhotoCount.mockResolvedValue(0);
      dataSource.query.mockResolvedValue([]);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'cleaner');

      expect(result.fields.find((f) => f.name === 'kyc')?.completed).toBe(false);
    });

    it('should mark availability as completed when at least one day is enabled', async () => {
      profileRepository.findByUserId.mockResolvedValue(null);
      cleanerProfileRepo.findOne.mockResolvedValue({
        specialties: [],
        workZoneLat: null,
        availability: {
          monday: { enabled: false, start: null, end: null },
          wednesday: { enabled: true, start: '09:00', end: '14:00' },
        },
      } as unknown as CleanerProfile);
      portfolioService.getPhotoCount.mockResolvedValue(0);
      dataSource.query.mockResolvedValue([]);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'cleaner');

      expect(result.fields.find((f) => f.name === 'availability')?.completed).toBe(true);
    });

    it('should mark availability as incomplete when all days are disabled', async () => {
      profileRepository.findByUserId.mockResolvedValue(null);
      cleanerProfileRepo.findOne.mockResolvedValue({
        specialties: [],
        workZoneLat: null,
        availability: {
          monday: { enabled: false, start: null, end: null },
          tuesday: { enabled: false, start: null, end: null },
        },
      } as unknown as CleanerProfile);
      portfolioService.getPhotoCount.mockResolvedValue(0);
      dataSource.query.mockResolvedValue([]);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'cleaner');

      expect(result.fields.find((f) => f.name === 'availability')?.completed).toBe(false);
    });

    it('should mark availability as incomplete when availability is empty object', async () => {
      profileRepository.findByUserId.mockResolvedValue(null);
      cleanerProfileRepo.findOne.mockResolvedValue({
        specialties: [],
        workZoneLat: null,
        availability: {},
      } as unknown as CleanerProfile);
      portfolioService.getPhotoCount.mockResolvedValue(0);
      dataSource.query.mockResolvedValue([]);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'cleaner');

      expect(result.fields.find((f) => f.name === 'availability')?.completed).toBe(false);
    });

    it('should correctly sum partial completion percentage', async () => {
      profileRepository.findByUserId.mockResolvedValue({
        displayName: 'Maria',
        photoStorageKey: 'users/maria.jpg',
        bio: null,
      } as ProfileDetails);
      cleanerProfileRepo.findOne.mockResolvedValue({
        specialties: ['homes'],
        workZoneLat: null,
        availability: {},
      } as unknown as CleanerProfile);
      portfolioService.getPhotoCount.mockResolvedValue(0);
      dataSource.query.mockResolvedValue([]);

      const result = await service.calculateCompleteness(TEST_USER_ID, 'cleaner');

      // name:15 + photo:15 + specialties:15 = 45
      expect(result.percentage).toBe(45);
    });
  });

  describe('calculateCompleteness — unsupported role', () => {
    it('should return 0% with empty fields for unsupported role', async () => {
      const result = await service.calculateCompleteness(TEST_USER_ID, 'admin');

      expect(result.percentage).toBe(0);
      expect(result.role).toBe('admin');
      expect(result.fields).toHaveLength(0);
    });
  });

  describe('weight parsing', () => {
    it('should handle missing weight configuration gracefully', async () => {
      configService.get = jest.fn().mockReturnValue('');

      const result = await service.calculateCompleteness(TEST_USER_ID, 'host');

      expect(result.percentage).toBe(0);
      expect(result.fields).toHaveLength(0);
    });
  });
});
