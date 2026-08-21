import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ProfileCompleteness, CompletenessField, DayAvailability } from '../profile.types';
import { CompletenessWeightValidator } from './completeness-weight.validator';
import { CompletenessFieldWeight } from './completeness.types';
import { ProfileRepository } from '../profile.repository';
import { PortfolioService } from '../portfolio/portfolio.service';
import { HostProfile } from '../../roles/entities/host-profile.entity';
import { CleanerProfile } from '../../roles/entities/cleaner-profile.entity';
import { ProfileDetails } from '../entities/profile-details.entity';
import { KycStatus } from '../../kyc/kyc.types';

/** Supported roles for completeness calculation */
const SUPPORTED_ROLES = ['host', 'cleaner'] as const;
type SupportedRole = (typeof SUPPORTED_ROLES)[number];

/** Env variable keys per role */
const WEIGHT_ENV_KEYS: Record<SupportedRole, string> = {
  host: 'PROFILE_COMPLETENESS_WEIGHTS_HOST',
  cleaner: 'PROFILE_COMPLETENESS_WEIGHTS_CLEANER',
};

/**
 * Completeness service.
 * Calculates profile completion percentage per role using configurable field weights.
 * Validates weight sums on boot (must equal 100).
 * Completeness is computed on every request — never cached.
 */
@Injectable()
export class CompletenessService implements OnModuleInit {
  private readonly logger = new Logger(CompletenessService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly weightValidator: CompletenessWeightValidator,
    private readonly profileRepository: ProfileRepository,
    private readonly portfolioService: PortfolioService,
    @InjectRepository(HostProfile)
    private readonly hostProfileRepo: Repository<HostProfile>,
    @InjectRepository(CleanerProfile)
    private readonly cleanerProfileRepo: Repository<CleanerProfile>,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.weightValidator.validateWeights();
  }

  /**
   * Calculate profile completeness for a user in a given role.
   * Returns percentage, role, and per-field status with weights.
   */
  async calculateCompleteness(userId: string, role: string): Promise<ProfileCompleteness> {
    const normalizedRole = role.toLowerCase() as SupportedRole;

    if (!SUPPORTED_ROLES.includes(normalizedRole)) {
      return { percentage: 0, role, fields: [] };
    }

    const weights = this.parseWeights(normalizedRole);
    const fields = await this.evaluateFields(userId, normalizedRole, weights);
    const percentage = this.computePercentage(fields);

    return { percentage, role: normalizedRole, fields };
  }

  /**
   * Parse the comma/colon weight format from env: "field:weight,field:weight"
   */
  private parseWeights(role: SupportedRole): CompletenessFieldWeight[] {
    const envKey = WEIGHT_ENV_KEYS[role];
    const raw = this.configService.get<string>(envKey, '');

    if (!raw) {
      this.logger.warn(`No completeness weights configured for role: ${role}`);
      return [];
    }

    return raw.split(',').map((entry) => {
      const parts = entry.trim().split(':');
      const name = parts[0] ?? '';
      const weightStr = parts[1] ?? '0';
      return { name: name.trim(), weight: Number(weightStr) };
    });
  }

  /**
   * Evaluate each field's completion status for the given role.
   */
  private async evaluateFields(
    userId: string,
    role: SupportedRole,
    weights: CompletenessFieldWeight[],
  ): Promise<CompletenessField[]> {
    if (role === 'host') {
      return this.evaluateHostFields(userId, weights);
    }
    return this.evaluateCleanerFields(userId, weights);
  }

  /**
   * Evaluate Host-specific field completion.
   */
  private async evaluateHostFields(
    userId: string,
    weights: CompletenessFieldWeight[],
  ): Promise<CompletenessField[]> {
    const [profileDetails, hostProfile] = await Promise.all([
      this.profileRepository.findByUserId(userId),
      this.hostProfileRepo.findOne({ where: { userId } }),
    ]);

    const checkers: Record<string, boolean> = {
      name: this.isNameCompleted(profileDetails),
      photo: this.isPhotoCompleted(profileDetails),
      business_name: this.isBusinessNameCompleted(hostProfile),
      payment_method: this.isPaymentMethodCompleted(hostProfile),
      first_property: false, // Placeholder — depends on properties module (not yet implemented)
    };

    return this.buildFields(weights, checkers);
  }

  /**
   * Evaluate Cleaner-specific field completion.
   */
  private async evaluateCleanerFields(
    userId: string,
    weights: CompletenessFieldWeight[],
  ): Promise<CompletenessField[]> {
    const [profileDetails, cleanerProfile, photoCount, kycVerified] = await Promise.all([
      this.profileRepository.findByUserId(userId),
      this.cleanerProfileRepo.findOne({ where: { userId } }),
      this.portfolioService.getPhotoCount(userId),
      this.isKycVerified(userId),
    ]);

    const checkers: Record<string, boolean> = {
      name: this.isNameCompleted(profileDetails),
      photo: this.isPhotoCompleted(profileDetails),
      specialties: this.isSpecialtiesCompleted(cleanerProfile),
      work_zone: this.isWorkZoneCompleted(cleanerProfile),
      availability: this.isAvailabilityCompleted(cleanerProfile),
      portfolio: photoCount > 0,
      kyc: kycVerified,
      bio: this.isBioCompleted(profileDetails),
    };

    return this.buildFields(weights, checkers);
  }

  /** Build CompletenessField array from weights and checker results */
  private buildFields(
    weights: CompletenessFieldWeight[],
    checkers: Record<string, boolean>,
  ): CompletenessField[] {
    return weights.map(({ name, weight }) => ({
      name,
      completed: checkers[name] ?? false,
      weight,
    }));
  }

  /** Compute total percentage from completed fields */
  private computePercentage(fields: CompletenessField[]): number {
    return fields.reduce((sum, field) => (field.completed ? sum + field.weight : sum), 0);
  }

  // --- Field checkers ---

  private isNameCompleted(profile: ProfileDetails | null): boolean {
    return !!profile?.displayName && profile.displayName.trim().length > 0;
  }

  private isPhotoCompleted(profile: ProfileDetails | null): boolean {
    return profile?.photoStorageKey != null;
  }

  private isBusinessNameCompleted(hostProfile: HostProfile | null): boolean {
    return !!hostProfile?.businessName && hostProfile.businessName.trim().length > 0;
  }

  private isPaymentMethodCompleted(hostProfile: HostProfile | null): boolean {
    return hostProfile?.paymentMethodAdded === true;
  }

  private isSpecialtiesCompleted(cleanerProfile: CleanerProfile | null): boolean {
    return Array.isArray(cleanerProfile?.specialties) && cleanerProfile.specialties.length > 0;
  }

  private isWorkZoneCompleted(cleanerProfile: CleanerProfile | null): boolean {
    return cleanerProfile?.workZoneLat != null;
  }

  private isAvailabilityCompleted(cleanerProfile: CleanerProfile | null): boolean {
    if (!cleanerProfile?.availability || typeof cleanerProfile.availability !== 'object') {
      return false;
    }

    const availability = cleanerProfile.availability as Record<string, DayAvailability>;

    return Object.values(availability).some((day) => day?.enabled === true);
  }

  private isBioCompleted(profile: ProfileDetails | null): boolean {
    return !!profile?.bio && profile.bio.trim().length > 0;
  }

  /** Check if the user's latest KYC verification has VERIFIED status */
  private async isKycVerified(userId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT status FROM kyc_verifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId],
    );

    if (!rows || rows.length === 0) {
      return false;
    }

    return rows[0].status === KycStatus.VERIFIED;
  }
}
