import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProfileDetails } from './entities/profile-details.entity';
import { PublicProfile } from './profile.types';

/**
 * Profile repository.
 * Encapsulates database queries for the profile module.
 * Includes dedicated findPublicProfile query that SELECTs only public columns.
 */
@Injectable()
export class ProfileRepository {
  constructor(
    @InjectRepository(ProfileDetails)
    private readonly profileDetailsRepo: Repository<ProfileDetails>,
  ) {}

  async findByUserId(userId: string): Promise<ProfileDetails | null> {
    return this.profileDetailsRepo.findOne({ where: { userId } });
  }

  async findByUserIdOrFail(userId: string): Promise<ProfileDetails> {
    const profile = await this.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException('profile.error.not_found');
    }
    return profile;
  }

  /**
   * Dedicated public profile query.
   * SELECTs only non-sensitive public columns — NEVER email, phone, settings, exact coordinates.
   */
  async findPublicProfile(_userId: string): Promise<PublicProfile | null> {
    throw new Error('Not implemented');
  }

  async createProfile(data: Partial<ProfileDetails>): Promise<ProfileDetails> {
    const profile = this.profileDetailsRepo.create(data);
    return this.profileDetailsRepo.save(profile);
  }

  async updateProfile(
    userId: string,
    data: Partial<ProfileDetails>,
  ): Promise<ProfileDetails> {
    await this.profileDetailsRepo.update({ userId }, data);
    return this.findByUserIdOrFail(userId);
  }
}
