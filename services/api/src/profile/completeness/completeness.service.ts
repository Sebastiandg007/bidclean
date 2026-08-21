import { Injectable, NotImplementedException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProfileCompleteness } from '../profile.types';
import { CompletenessWeightValidator } from './completeness-weight.validator';

/**
 * Completeness service.
 * Calculates profile completion percentage per role using configurable field weights.
 * Validates weight sums on boot (must equal 100).
 */
@Injectable()
export class CompletenessService implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService,
    private readonly weightValidator: CompletenessWeightValidator,
  ) {}

  onModuleInit(): void {
    this.weightValidator.validateWeights();
  }

  async calculateCompleteness(_userId: string, _role: string): Promise<ProfileCompleteness> {
    void this.configService;
    throw new NotImplementedException();
  }
}
