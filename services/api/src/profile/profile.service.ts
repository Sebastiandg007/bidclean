import { Injectable, NotImplementedException } from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { PrivateProfile, PublicProfile } from './profile.types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateHostProfileDto } from './dto/update-host-profile.dto';
import { UpdateCleanerProfileDto } from './dto/update-cleaner-profile.dto';

/**
 * Core profile service.
 * Orchestrates profile CRUD operations across common and role-specific fields.
 */
@Injectable()
export class ProfileService {
  constructor(private readonly profileRepository: ProfileRepository) {}

  async getPrivateProfile(_userId: string): Promise<PrivateProfile> {
    void this.profileRepository;
    throw new NotImplementedException();
  }

  async getPublicProfile(_userId: string): Promise<PublicProfile> {
    throw new NotImplementedException();
  }

  async updateCommonProfile(
    _userId: string,
    _dto: UpdateProfileDto,
  ): Promise<PrivateProfile> {
    throw new NotImplementedException();
  }

  async updateHostProfile(
    _userId: string,
    _dto: UpdateHostProfileDto,
  ): Promise<PrivateProfile> {
    throw new NotImplementedException();
  }

  async updateCleanerProfile(
    _userId: string,
    _dto: UpdateCleanerProfileDto,
  ): Promise<PrivateProfile> {
    throw new NotImplementedException();
  }
}
