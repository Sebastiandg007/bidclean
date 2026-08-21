import {
  Injectable,
  NotFoundException,
  BadRequestException,
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
} from './profile.types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateHostProfileDto } from './dto/update-host-profile.dto';
import { UpdateCleanerProfileDto } from './dto/update-cleaner-profile.dto';
import { User } from '../auth/entities/user.entity';
import { HostProfile } from '../roles/entities/host-profile.entity';
import { CleanerProfile } from '../roles/entities/cleaner-profile.entity';
import { ProfileDetails } from './entities/profile-details.entity';

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

  async updateHostProfile(
    _userId: string,
    _dto: UpdateHostProfileDto,
  ): Promise<PrivateProfile> {
    throw new NotFoundException('profile.error.not_found');
  }

  async updateCleanerProfile(
    _userId: string,
    _dto: UpdateCleanerProfileDto,
  ): Promise<PrivateProfile> {
    throw new NotFoundException('profile.error.not_found');
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
}
