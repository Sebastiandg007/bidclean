import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Boot-time validator for completeness weights.
 * Ensures sum(weights) === 100 for both Host and Cleaner configs.
 * Application fails fast if validation fails.
 */
@Injectable()
export class CompletenessWeightValidator {
  private readonly logger = new Logger(CompletenessWeightValidator.name);
  private readonly EXPECTED_SUM = 100;

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

  private validateRoleWeights(role: string, weightsJson: string): void {
    try {
      const weights = JSON.parse(weightsJson) as Record<string, number>;
      const sum = Object.values(weights).reduce((acc, val) => acc + val, 0);

      if (sum !== this.EXPECTED_SUM) {
        const errorMessage =
          `Profile completeness weights for ${role} sum to ${sum}, expected ${this.EXPECTED_SUM}.`;
        this.logger.error(errorMessage);
        throw new Error(errorMessage);
      }

      this.logger.log(`Profile completeness weights for ${role} validated successfully (sum=${sum}).`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        const errorMessage = `Invalid JSON for ${role} completeness weights configuration.`;
        this.logger.error(errorMessage);
        throw new Error(errorMessage);
      }
      throw error;
    }
  }
}
