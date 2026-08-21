import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ProfileDetails } from './entities/profile-details.entity';
import { PublicProfileRow } from './profile.types';
import { KycStatus } from '../kyc/kyc.types';

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
    private readonly dataSource: DataSource,
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
   * SELECTs ONLY non-sensitive public columns via explicit column list.
   * NEVER selects: email, phone_number, settings, work_zone_lat, work_zone_lng.
   */
  async findPublicProfile(userId: string): Promise<PublicProfileRow | null> {
    const rows = await this.dataSource.query(
      `SELECT
        u.id AS "userId",
        pd.display_name AS "displayName",
        pd.photo_storage_key AS "photoStorageKey",
        pd.bio AS "bio",
        u.created_at AS "memberSince",
        cp.specialties AS "specialties",
        EXISTS (
          SELECT 1 FROM kyc_verifications kv
          WHERE kv.user_id = u.id AND kv.status = $2
        ) AS "isKycVerified"
      FROM users u
      LEFT JOIN profile_details pd ON pd.user_id = u.id
      LEFT JOIN cleaner_profiles cp ON cp.user_id = u.id
      WHERE u.id = $1
      LIMIT 1`,
      [userId, KycStatus.VERIFIED],
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    return rows[0] as PublicProfileRow;
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