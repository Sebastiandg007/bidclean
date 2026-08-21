import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProfileRepository } from './profile.repository';
import { ProfilePhotoService } from './photo/profile-photo.service';
import {
  PrivateProfile,
  PublicProfile,
  HostProfileFields,
  CleanerProfileFields,
  DayOfWeek,
  DayAvailability,
  WeeklyAvailability,
} from './profile.types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateHostProfileDto } from './dto/update-host-profile.dto';
import { UpdateCleanerProfileDto } from './dto/update-cleaner-profile.dto';
import { User } from '../auth/entities/user.entity';
import { HostProfile } from '../roles/entities/host-profile.entity';
import { CleanerProfile } from '../roles/entities/cleaner-profile.entity';
import { ProfileDetails } from './entities/profile-details.entity';

const DAYS_OF_WEEK: DayOfWeek[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_BIO_MAX_LENGTH = 2000;

/**
 * Core profile service.
 * Orchestrates profile CRUD operations across common and role-specific fields.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly profilePhotoService: ProfilePhotoService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(HostProfile)
    private readonly hostProfileRepository: Repository<HostProfile>,
    @InjectRepository(CleanerProfile)
    private readonly cleanerProfileRepository: Repository<CleanerProfile>,
  ) {}

  /**
   * Get the full private profile for a user identified by their Keycloak ID.
   * Includes role-specific fields and a signed photo URL when available.
   */
  async getPrivateProfile(keycloakId: string): Promise<PrivateProfile> {
    const user = await this.findUserByKeycloakId(keycloakId);
    const profileDetails = await this.findOrCreateProfileDetails(user.id);
    const photoUrl = await this.resolvePhotoUrl(profileDetails.photoStorageKey);
    const hostProfile = await this.resolveHostProfile(user);
    const cleanerProfile = await this.resolveCleanerProfile(user);

    return {
      id: profileDetails.id,
      userId: user.id,
      email: user.email,
      displayName: profileDetails.displayName,
      phoneNumber: profileDetails.phoneNumber,
      photoUrl,
      bio: profileDetails.bio,
      activeRole: user.activeRole,
      roles: user.roles,
      hostProfile,
      cleanerProfile,
      createdAt: user.createdAt,
      updatedAt: profileDetails.updatedAt,
    };
  }

  async getPublicProfile(_userId: string): Promise<PublicProfile> {
    throw new NotFoundException('profile.error.not_found');
  }

  /**
   * Updates common profile fields (display_name, phone_number).
   * Validates display_name is non-empty when provided.
   * Returns the full updated PrivateProfile.
   */
  async updateCommonProfile(
    keycloakId: string,
    dto: UpdateProfileDto,
  ): Promise<PrivateProfile> {
    const user = await this.findUserByKeycloakId(keycloakId);
    await this.findOrCreateProfileDetails(user.id);

    const updateData = this.buildCommonUpdateData(dto);
    await this.profileRepository.updateProfile(user.id, updateData);

    return this.getPrivateProfile(keycloakId);
  }

  /**
   * Builds partial update object from the DTO.
   * Only includes fields that are explicitly provided (not undefined).
   * Validates display_name is non-empty when provided.
   */
  private buildCommonUpdateData(
    dto: UpdateProfileDto,
  ): Partial<ProfileDetails> {
    const data: Partial<ProfileDetails> = {};

    if (dto.displayName !== undefined) {
      if (dto.displayName.trim().length === 0) {
        throw new BadRequestException('profile.error.invalid_display_name');
      }
      data.displayName = dto.displayName;
    }

    if (dto.phoneNumber !== undefined) {
      data.phoneNumber = dto.phoneNumber;
    }

    return data;
  }

  /**
   * Updates host-specific profile fields (business_name).
   * Verifies user has 'host' role and host profile exists.
   * Returns the full updated PrivateProfile.
   */
  async updateHostProfile(
    keycloakId: string,
    dto: UpdateHostProfileDto,
  ): Promise<PrivateProfile> {
    const user = await this.findUserByKeycloakId(keycloakId);
    this.validateHostRole(user);

    const hostProfile = await this.findHostProfileOrFail(user.id);
    await this.applyHostProfileUpdates(hostProfile, dto);

    return this.getPrivateProfile(keycloakId);
  }

  /**
   * Updates cleaner-specific profile fields (specialties, work_zone, availability, bio).
   * Verifies user has 'cleaner' role and cleaner profile exists.
   * Validates availability JSONB schema and bio max length.
   * Returns the full updated PrivateProfile.
   */
  async updateCleanerProfile(
    keycloakId: string,
    dto: UpdateCleanerProfileDto,
  ): Promise<PrivateProfile> {
    const user = await this.findUserByKeycloakId(keycloakId);
    this.validateCleanerRole(user);

    const cleanerProfile = await this.findCleanerProfileOrFail(user.id);

    this.validateCleanerDto(dto);
    await this.applyCleanerProfileUpdates(cleanerProfile, dto);
    await this.updateBioIfProvided(user.id, dto.bio);

    return this.getPrivateProfile(keycloakId);
  }

  /** Finds the internal user by their Keycloak subject ID. */
  private async findUserByKeycloakId(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { keycloakId },
    });

    if (!user) {
      throw new NotFoundException('profile.error.user_not_found');
    }

    return user;
  }

  /** Finds existing profile_details or creates a default row for the user. */
  private async findOrCreateProfileDetails(userId: string): Promise<ProfileDetails> {
    const existing = await this.profileRepository.findByUserId(userId);

    if (existing) {
      return existing;
    }

    return this.profileRepository.createProfile({
      userId,
      displayName: '',
      phoneNumber: null,
      photoStorageKey: null,
      bio: null,
    });
  }

  /** Generates a signed photo URL if a storage key exists, otherwise null. */
  private async resolvePhotoUrl(
    photoStorageKey: string | null,
  ): Promise<string | null> {
    if (!photoStorageKey) {
      return null;
    }

    const signedResult =
      await this.profilePhotoService.getSignedUrl(photoStorageKey);
    return signedResult.url;
  }

  /** Resolves host-specific fields if the user has the host role. */
  private async resolveHostProfile(
    user: User,
  ): Promise<HostProfileFields | null> {
    if (!user.roles.includes('host')) {
      return null;
    }

    const hostProfile = await this.hostProfileRepository.findOne({
      where: { userId: user.id },
    });

    if (!hostProfile) {
      return null;
    }

    return { businessName: hostProfile.businessName };
  }

  /** Resolves cleaner-specific fields if the user has the cleaner role. */
  private async resolveCleanerProfile(
    user: User,
  ): Promise<CleanerProfileFields | null> {
    if (!user.roles.includes('cleaner')) {
      return null;
    }

    const cleanerProfile = await this.cleanerProfileRepository.findOne({
      where: { userId: user.id },
    });

    if (!cleanerProfile) {
      return null;
    }

    const workZoneCenter =
      cleanerProfile.workZoneLat !== null && cleanerProfile.workZoneLng !== null
        ? { lat: cleanerProfile.workZoneLat, lng: cleanerProfile.workZoneLng }
        : null;

    return {
      specialties: cleanerProfile.specialties,
      workZoneCenter,
      workZoneRadiusKm: cleanerProfile.workZoneRadiusKm,
      workZoneLabel: null,
      availability: cleanerProfile.availability as CleanerProfileFields['availability'],
    };
  }

  /** Validates that the user has the host role assigned. */
  private validateHostRole(user: User): void {
    if (!user.roles.includes('host')) {
      throw new ForbiddenException('profile.error.not_host');
    }
  }

  /** Finds the host profile for a user, throws if not found. */
  private async findHostProfileOrFail(userId: string): Promise<HostProfile> {
    const hostProfile = await this.hostProfileRepository.findOne({
      where: { userId },
    });

    if (!hostProfile) {
      throw new NotFoundException('profile.error.not_found');
    }

    return hostProfile;
  }

  /** Applies DTO updates to the host profile entity. */
  private async applyHostProfileUpdates(
    hostProfile: HostProfile,
    dto: UpdateHostProfileDto,
  ): Promise<void> {
    if (dto.businessName !== undefined) {
      hostProfile.businessName = dto.businessName ?? null;
    }

    await this.hostProfileRepository.save(hostProfile);
  }

  /** Validates that the user has the cleaner role assigned. */
  private validateCleanerRole(user: User): void {
    if (!user.roles.includes('cleaner')) {
      throw new ForbiddenException('profile.error.not_cleaner');
    }
  }

  /** Finds the cleaner profile for a user, throws if not found. */
  private async findCleanerProfileOrFail(userId: string): Promise<CleanerProfile> {
    const cleanerProfile = await this.cleanerProfileRepository.findOne({
      where: { userId },
    });

    if (!cleanerProfile) {
      throw new NotFoundException('profile.error.not_found');
    }

    return cleanerProfile;
  }

  /** Validates the cleaner DTO fields: availability schema and bio length. */
  private validateCleanerDto(dto: UpdateCleanerProfileDto): void {
    if (dto.availability !== undefined) {
      this.validateAvailabilitySchema(dto.availability);
    }

    if (dto.bio !== undefined) {
      this.validateBioLength(dto.bio);
    }
  }

  /** Validates the WeeklyAvailability JSONB schema. */
  private validateAvailabilitySchema(availability: WeeklyAvailability): void {
    const keys = Object.keys(availability);
    const hasAllDays = DAYS_OF_WEEK.every((day) => keys.includes(day));
    const hasOnlyValidDays = keys.every((key) =>
      DAYS_OF_WEEK.includes(key as DayOfWeek),
    );

    if (!hasAllDays || !hasOnlyValidDays) {
      throw new BadRequestException('profile.error.invalid_availability');
    }

    for (const day of DAYS_OF_WEEK) {
      this.validateDayAvailability(day, availability[day]);
    }
  }

  /** Validates a single day's availability slot. */
  private validateDayAvailability(_day: string, slot: DayAvailability): void {
    if (typeof slot.enabled !== 'boolean') {
      throw new BadRequestException('profile.error.invalid_availability');
    }

    if (slot.enabled) {
      if (!slot.start || !slot.end) {
        throw new BadRequestException('profile.error.invalid_availability');
      }
      if (!TIME_FORMAT_REGEX.test(slot.start) || !TIME_FORMAT_REGEX.test(slot.end)) {
        throw new BadRequestException('profile.error.invalid_availability');
      }
    } else {
      if (slot.start !== null || slot.end !== null) {
        throw new BadRequestException('profile.error.invalid_availability');
      }
    }
  }

  /** Validates bio does not exceed configurable max length. */
  private validateBioLength(bio: string): void {
    const maxLength = parseInt(
      process.env.PROFILE_BIO_MAX_LENGTH ?? String(DEFAULT_BIO_MAX_LENGTH),
      10,
    );

    if (bio.length > maxLength) {
      throw new BadRequestException('profile.error.bio_too_long');
    }
  }

  /** Applies DTO updates to the cleaner profile entity. */
  private async applyCleanerProfileUpdates(
    cleanerProfile: CleanerProfile,
    dto: UpdateCleanerProfileDto,
  ): Promise<void> {
    if (dto.specialties !== undefined) {
      cleanerProfile.specialties = dto.specialties;
    }

    if (dto.workZoneCenter !== undefined) {
      cleanerProfile.workZoneLat = dto.workZoneCenter.lat;
      cleanerProfile.workZoneLng = dto.workZoneCenter.lng;
    }

    if (dto.workZoneRadiusKm !== undefined) {
      cleanerProfile.workZoneRadiusKm = dto.workZoneRadiusKm;
    }

    if (dto.availability !== undefined) {
      cleanerProfile.availability = dto.availability as Record<string, unknown>;
    }

    await this.cleanerProfileRepository.save(cleanerProfile);
  }

  /** Updates bio in profile_details if provided in the DTO. */
  private async updateBioIfProvided(
    userId: string,
    bio: string | undefined,
  ): Promise<void> {
    if (bio === undefined) {
      return;
    }

    await this.profileRepository.updateProfile(userId, { bio });
  }
}
