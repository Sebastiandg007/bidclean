import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingsService } from '../settings/settings.service';
import { UserSettings } from '../entities/user-settings.entity';

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getRepositoryToken(UserSettings), useValue: {} },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSettings', () => {
    it.todo('should return user settings');
    it.todo('should create default settings if none exist');
  });

  describe('updateSettings', () => {
    it.todo('should update settings with valid values');
    it.todo('should reject invalid theme value');
  });
});
