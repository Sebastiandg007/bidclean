import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSettings } from '../entities/user-settings.entity';
import { UpdateSettingsDto } from '../dto/update-settings.dto';

/**
 * Settings service.
 * Manages user preferences (language, theme, notifications).
 * Creates default settings on first access.
 */
@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(UserSettings)
    private readonly settingsRepo: Repository<UserSettings>,
  ) {}

  async getSettings(_userId: string): Promise<UserSettings> {
    void this.settingsRepo;
    throw new NotImplementedException();
  }

  async updateSettings(_userId: string, _dto: UpdateSettingsDto): Promise<UserSettings> {
    throw new NotImplementedException();
  }

  async createDefaultSettings(_userId: string): Promise<UserSettings> {
    throw new NotImplementedException();
  }
}
