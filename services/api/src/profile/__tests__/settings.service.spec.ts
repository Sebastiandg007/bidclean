import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { UserSettings } from '../entities/user-settings.entity';
import { UpdateSettingsDto } from '../dto/update-settings.dto';
import { DEFAULT_SETTINGS } from '../settings/settings.types';

describe('SettingsService', () => {
  let service: SettingsService;
  let mockRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };

  const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';

  const mockExistingSettings: UserSettings = {
    id: 'settings-uuid-1',
    userId: TEST_USER_ID,
    language: 'en',
    theme: 'system',
    isPushEnabled: true,
    isEmailNotificationsEnabled: true,
    isSoundsEnabled: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    mockRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getRepositoryToken(UserSettings), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSettings', () => {
    it('should return existing settings when found', async () => {
      mockRepo.findOne.mockResolvedValue(mockExistingSettings);

      const result = await service.getSettings(TEST_USER_ID);

      expect(result).toEqual(mockExistingSettings);
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { userId: TEST_USER_ID },
      });
    });

    it('should create and return default settings when none exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockReturnValue(mockExistingSettings);
      mockRepo.save.mockResolvedValue(mockExistingSettings);

      const result = await service.getSettings(TEST_USER_ID);

      expect(result).toEqual(mockExistingSettings);
      expect(mockRepo.create).toHaveBeenCalledWith({
        userId: TEST_USER_ID,
        language: DEFAULT_SETTINGS.language,
        theme: DEFAULT_SETTINGS.theme,
        isPushEnabled: DEFAULT_SETTINGS.isPushEnabled,
        isEmailNotificationsEnabled: DEFAULT_SETTINGS.isEmailNotificationsEnabled,
        isSoundsEnabled: DEFAULT_SETTINGS.isSoundsEnabled,
      });
      expect(mockRepo.save).toHaveBeenCalled();
    });
  });

  describe('updateSettings', () => {
    beforeEach(() => {
      mockRepo.findOne.mockResolvedValue({ ...mockExistingSettings });
      mockRepo.save.mockImplementation((entity) => Promise.resolve(entity));
    });

    it('should update language with valid value', async () => {
      const dto: UpdateSettingsDto = { language: 'es' };

      const result = await service.updateSettings(TEST_USER_ID, dto);

      expect(result.language).toBe('es');
    });

    it('should normalize language to lowercase', async () => {
      const dto: UpdateSettingsDto = { language: 'FR' };

      const result = await service.updateSettings(TEST_USER_ID, dto);

      expect(result.language).toBe('fr');
    });

    it('should update theme with valid value', async () => {
      const dto: UpdateSettingsDto = { theme: 'dark' };

      const result = await service.updateSettings(TEST_USER_ID, dto);

      expect(result.theme).toBe('dark');
    });

    it('should update boolean notification fields', async () => {
      const dto: UpdateSettingsDto = {
        isPushEnabled: false,
        isEmailNotificationsEnabled: false,
        isSoundsEnabled: false,
      };

      const result = await service.updateSettings(TEST_USER_ID, dto);

      expect(result.isPushEnabled).toBe(false);
      expect(result.isEmailNotificationsEnabled).toBe(false);
      expect(result.isSoundsEnabled).toBe(false);
    });

    it('should only update provided fields (partial update)', async () => {
      const dto: UpdateSettingsDto = { theme: 'light' };

      const result = await service.updateSettings(TEST_USER_ID, dto);

      expect(result.theme).toBe('light');
      expect(result.language).toBe('en');
      expect(result.isPushEnabled).toBe(true);
    });

    it('should reject invalid language code', async () => {
      const dto: UpdateSettingsDto = { language: 'zh' };

      await expect(
        service.updateSettings(TEST_USER_ID, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid theme value', async () => {
      const dto: UpdateSettingsDto = { theme: 'purple' };

      await expect(
        service.updateSettings(TEST_USER_ID, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject non-boolean notification value', async () => {
      const dto = { isPushEnabled: 'yes' } as unknown as UpdateSettingsDto;

      await expect(
        service.updateSettings(TEST_USER_ID, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept all supported languages', async () => {
      const languages = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl'];

      for (const language of languages) {
        mockRepo.findOne.mockResolvedValue({ ...mockExistingSettings });
        const dto: UpdateSettingsDto = { language };
        const result = await service.updateSettings(TEST_USER_ID, dto);
        expect(result.language).toBe(language);
      }
    });

    it('should accept all valid theme values', async () => {
      const themes = ['dark', 'light', 'system'];

      for (const theme of themes) {
        mockRepo.findOne.mockResolvedValue({ ...mockExistingSettings });
        const dto: UpdateSettingsDto = { theme };
        const result = await service.updateSettings(TEST_USER_ID, dto);
        expect(result.theme).toBe(theme);
      }
    });
  });

  describe('createDefaultSettings', () => {
    it('should create settings with correct default values', async () => {
      const expectedDefaults = {
        userId: TEST_USER_ID,
        language: 'en',
        theme: 'system',
        isPushEnabled: true,
        isEmailNotificationsEnabled: true,
        isSoundsEnabled: true,
      };

      mockRepo.create.mockReturnValue(expectedDefaults);
      mockRepo.save.mockResolvedValue({
        id: 'new-settings-uuid',
        ...expectedDefaults,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createDefaultSettings(TEST_USER_ID);

      expect(mockRepo.create).toHaveBeenCalledWith(expectedDefaults);
      expect(result.language).toBe(DEFAULT_SETTINGS.language);
      expect(result.theme).toBe(DEFAULT_SETTINGS.theme);
      expect(result.isPushEnabled).toBe(DEFAULT_SETTINGS.isPushEnabled);
      expect(result.isEmailNotificationsEnabled).toBe(
        DEFAULT_SETTINGS.isEmailNotificationsEnabled,
      );
      expect(result.isSoundsEnabled).toBe(DEFAULT_SETTINGS.isSoundsEnabled);
    });
  });
});
