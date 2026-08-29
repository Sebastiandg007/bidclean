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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  const req = (keycloakId = 'kc-1') => ({ user: { keycloakId } }) as never;

  describe('POST /users/roles', () => {
    it('should call rolesService.assignRoles with the keycloakId and dto', async () => {
      const dto = { roles: ['host', 'cleaner'] } as never;
      const expected = { roles: ['host', 'cleaner'], activeRole: 'host', message: 'ok' };
      mockRolesService.assignRoles.mockResolvedValue(expected);

      const result = await controller.assignRoles(req(), dto);

      expect(mockRolesService.assignRoles).toHaveBeenCalledWith('kc-1', dto);
      expect(result).toBe(expected);
    });
  });

  describe('GET /users/me/roles', () => {
    it('should call rolesService.getUserRoles with the keycloakId', async () => {
      const expected = { roles: ['host'], activeRole: 'host' };
      mockRolesService.getUserRoles.mockResolvedValue(expected);

      const result = await controller.getUserRoles(req());

      expect(mockRolesService.getUserRoles).toHaveBeenCalledWith('kc-1');
      expect(result).toBe(expected);
    });
  });

  describe('PATCH /users/me/active-role', () => {
    it('should call rolesService.switchActiveRole with the keycloakId and role', async () => {
      const expected = { activeRole: 'cleaner', message: 'switched' };
      mockRolesService.switchActiveRole.mockResolvedValue(expected);

      const result = await controller.switchActiveRole(req(), { activeRole: 'cleaner' } as never);

      expect(mockRolesService.switchActiveRole).toHaveBeenCalledWith('kc-1', 'cleaner');
      expect(result).toBe(expected);
    });
  });

  describe('POST /users/me/host-profile', () => {
    it('should call rolesService.saveHostProfile with the keycloakId and dto', async () => {
      const dto = { displayName: 'Acme', isBusiness: true, businessName: 'Acme Inc' } as never;
      const expected = { id: 'hp-1' };
      mockRolesService.saveHostProfile.mockResolvedValue(expected);

      const result = await controller.saveHostProfile(req(), dto);

      expect(mockRolesService.saveHostProfile).toHaveBeenCalledWith('kc-1', dto);
      expect(result).toBe(expected);
    });
  });

  describe('POST /users/me/cleaner-profile', () => {
    it('should call rolesService.saveCleanerProfile with the keycloakId and dto', async () => {
      const dto = { displayName: 'Jane', workZoneRadiusKm: 10 } as never;
      const expected = { id: 'cp-1' };
      mockRolesService.saveCleanerProfile.mockResolvedValue(expected);

      const result = await controller.saveCleanerProfile(req(), dto);

      expect(mockRolesService.saveCleanerProfile).toHaveBeenCalledWith('kc-1', dto);
      expect(result).toBe(expected);
    });
  });

  describe('GET /users/me/onboarding-status', () => {
    it('should call rolesService.getOnboardingStatus with the keycloakId', async () => {
      const expected = { host: null, cleaner: null };
      mockRolesService.getOnboardingStatus.mockResolvedValue(expected);

      const result = await controller.getOnboardingStatus(req());

      expect(mockRolesService.getOnboardingStatus).toHaveBeenCalledWith('kc-1');
      expect(result).toBe(expected);
    });
  });
});
