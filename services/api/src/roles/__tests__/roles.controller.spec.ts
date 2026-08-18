import { Test, TestingModule } from '@nestjs/testing';
import { RolesController } from '../roles.controller';
import { RolesService } from '../roles.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

describe('RolesController', () => {
  let controller: RolesController;

  const mockRolesService = {
    assignRoles: jest.fn(),
    getUserRoles: jest.fn(),
    switchActiveRole: jest.fn(),
    saveHostProfile: jest.fn(),
    saveCleanerProfile: jest.fn(),
    getOnboardingStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [
        { provide: RolesService, useValue: mockRolesService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RolesController>(RolesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // TODO: Add tests in task 10
  describe('POST /users/roles', () => {
    it.todo('should call rolesService.assignRoles with user id and dto');
  });

  describe('GET /users/me/roles', () => {
    it.todo('should call rolesService.getUserRoles with user id');
  });

  describe('PATCH /users/me/active-role', () => {
    it.todo('should call rolesService.switchActiveRole with user id and role');
  });

  describe('POST /users/me/host-profile', () => {
    it.todo('should call rolesService.saveHostProfile with user id and dto');
  });

  describe('POST /users/me/cleaner-profile', () => {
    it.todo('should call rolesService.saveCleanerProfile with user id and dto');
  });

  describe('GET /users/me/onboarding-status', () => {
    it.todo('should call rolesService.getOnboardingStatus with user id');
  });
});
