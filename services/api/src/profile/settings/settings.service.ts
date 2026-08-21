import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSettings } from '../entities/user-settings.entity';
import { UpdateSettingsDto } from '../dto/update-settings.dto';
import {
  SUPPORTED_LANGUAGES,
  VALID_THEMES,
  DEFAULT_SETTINGS,
} from './settings.types';

/**
 * Settings service.
 * Manages user preferences (language, theme, notifications).
 * Creates default settings on first access (lazy creation pattern).
 */
@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(UserSettings)
    private readonly settingsRepo: Repository<UserSettings>,
  ) {}

  /**
   * Get settings for a user. Creates defaults if none exist (lazy creation).
   */
  async getSettings(userId: string): Promise<UserSettings> {
    const existing = await this.settingsRepo.findOne({ where: { userId } });

    if (existing) {
      return existing;
    }

    return this.createDefaultSettings(userId);
  }

  /**
   * Update user settings with validation. Only updates provided fields.
   */
  async updateSettings(
    userId: string,
    dto: UpdateSettingsDto,
  ): Promise<UserSettings> {
    this.validateSettingsDto(dto);

    const settings = await this.getSettings(userId);
    const updatedFields = this.buildUpdateData(dto);

    Object.assign(settings, updatedFields);
    return this.settingsRepo.save(settings);
  }

  /**
   * Create default settings row for a user.
   */
  async createDefaultSettings(userId: string): Promise<UserSettings> {
    const settings = this.settingsRepo.create({
      userId,
      language: DEFAULT_SETTINGS.language,
      theme: DEFAULT_SETTINGS.theme,
      isPushEnabled: DEFAULT_SETTINGS.isPushEnabled,
      isEmailNotificationsEnabled: DEFAULT_SETTINGS.isEmailNotificationsEnabled,
      isSoundsEnabled: DEFAULT_SETTINGS.isSoundsEnabled,
    });

    return this.settingsRepo.save(settings);
  }

  /** Validates all fields in the DTO that are provided. */
  private validateSettingsDto(dto: UpdateSettingsDto): void {
    if (dto.language !== undefined) {
      this.validateLanguage(dto.language);
    }

    if (dto.theme !== undefined) {
      this.validateTheme(dto.theme);
    }

    this.validateBooleanFields(dto);
  }

  /** Validates language is one of the supported codes. */
  private validateLanguage(language: string): void {
    const normalizedLanguage = language.toLowerCase();
    const isValid = (SUPPORTED_LANGUAGES as readonly string[]).includes(normalizedLanguage);

    if (!isValid) {
      throw new BadRequestException('profile.error.invalid_settings');
    }
  }

  /** Validates theme is one of the allowed values. */
  private validateTheme(theme: string): void {
    const isValid = (VALID_THEMES as string[]).includes(theme);

    if (!isValid) {
      throw new BadRequestException('profile.error.invalid_settings');
    }
  }

  /** Validates boolean fields are actual booleans (runtime safety net). */
  private validateBooleanFields(dto: UpdateSettingsDto): void {
    const booleanFields: (keyof UpdateSettingsDto)[] = [
      'isPushEnabled',
      'isEmailNotificationsEnabled',
      'isSoundsEnabled',
    ];

    for (const field of booleanFields) {
      if (dto[field] !== undefined && typeof dto[field] !== 'boolean') {
        throw new BadRequestException('profile.error.invalid_settings');
      }
    }
  }

  /** Builds partial update data from DTO, only including provided fields. */
  private buildUpdateData(dto: UpdateSettingsDto): Partial<UserSettings> {
    const data: Partial<UserSettings> = {};

    if (dto.language !== undefined) {
      data.language = dto.language.toLowerCase();
    }

    if (dto.theme !== undefined) {
      data.theme = dto.theme;
    }

    if (dto.isPushEnabled !== undefined) {
      data.isPushEnabled = dto.isPushEnabled;
    }

    if (dto.isEmailNotificationsEnabled !== undefined) {
      data.isEmailNotificationsEnabled = dto.isEmailNotificationsEnabled;
    }

    if (dto.isSoundsEnabled !== undefined) {
      data.isSoundsEnabled = dto.isSoundsEnabled;
    }

    return data;
  }
}
