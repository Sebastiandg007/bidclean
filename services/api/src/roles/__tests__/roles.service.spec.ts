import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RolesService } from '../roles.service';
import { HostProfile } from '../entities/host-profile.entity';
import { CleanerProfile } from '../entities/cleaner-profile.entity';

describe('RolesService', () => {
  let service: RolesService;

  const mockHostProfileRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockCleanerProfileRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        {
          provide: getRepositoryToken(HostProfile),
          useValue: mockHostProfileRepository,
        },
        {
          provide: getRepositoryToken(CleanerProfile),
          useValue: mockCleanerProfileRepository,
        },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // TODO: Add tests in task 10
  describe('assignRoles', () => {
    it.todo('should assign a single role to a user');
    it.todo('should assign both roles to a user');
    it.todo('should be idempotent when re-assigning an existing role');
  });

  describe('getUserRoles', () => {
    it.todo('should return the user roles and active role');
  });

  describe('switchActiveRole', () => {
    it.todo('should switch active role when role is assigned');
    it.todo('should reject switching to a role that is not assigned');
  });

  describe('saveHostProfile', () => {
    it.todo('should create a host profile');
    it.todo('should update an existing host profile');
  });

  describe('saveCleanerProfile', () => {
    it.todo('should create a cleaner profile');
    it.todo('should update an existing cleaner profile');
  });

  describe('getOnboardingStatus', () => {
    it.todo('should return onboarding status per role');
  });
});
