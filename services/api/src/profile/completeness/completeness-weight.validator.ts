import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Expected sum of all field weights per role */
const EXPECTED_WEIGHT_SUM = 100;

/**
 * Boot-time validator for completeness weights.
 * Parses the "field:weight,field:weight" env format and ensures sum(weights) === 100
 * for both Host and Cleaner configs.
 * Application fails fast if validation fails.
 */
@Injectable()
export class CompletenessWeightValidator {
  private readonly logger = new Logger(CompletenessWeightValidator.name);

  constructor(private readonly configService: ConfigService) {}

  validateWeights(): void {
    const hostWeights = this.configService.get<string>('PROFILE_COMPLETENESS_WEIGHTS_HOST');
    const cleanerWeights = this.configService.get<string>('PROFILE_COMPLETENESS_WEIGHTS_CLEANER');

    if (hostWeights) {
      this.validateRoleWeights('Host', hostWeights);
    }

    if (cleanerWeights) {
      this.validateRoleWeights('Cleaner', cleanerWeights);
    }
  }

  private validateRoleWeights(role: string, weightsRaw: string): void {
    const entries = this.parseWeightString(role, weightsRaw);
    const sum = entries.reduce((acc, val) => acc + val.weight, 0);

    if (sum !== EXPECTED_WEIGHT_SUM) {
      const errorMessage =
        `Profile completeness weights for ${role} sum to ${sum}, expected ${EXPECTED_WEIGHT_SUM}.`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    this.logger.log(`Profile completeness weights for ${role} validated successfully (sum=${sum}).`);
  }

  /**
   * Parse "field:weight,field:weight" format into structured entries.
   * Validates that each entry has a valid name and numeric weight.
   */
  private parseWeightString(
    role: string,
    raw: string,
  ): { name: string; weight: number }[] {
    const entries = raw.split(',').map((entry) => {
      const parts = entry.trim().split(':');
      if (parts.length !== 2) {
        throw new Error(
          `Invalid completeness weight entry for ${role}: "${entry}". Expected format: "field:weight"`,
        );
      }

      const name = (parts[0] ?? '').trim();
      const weight = Number((parts[1] ?? '').trim());

      if (!name) {
        throw new Error(`Empty field name in completeness weights for ${role}: "${entry}"`);
      }

      if (isNaN(weight) || weight < 0) {
        throw new Error(
          `Invalid weight value in completeness weights for ${role}: "${entry}". Must be a non-negative number.`,
        );
      }

      return { name, weight };
    });

    return entries;
  }
}
