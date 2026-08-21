import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CompletenessWeightValidator } from '../completeness/completeness-weight.validator';

describe('CompletenessWeightValidator', () => {
  let validator: CompletenessWeightValidator;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    configService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompletenessWeightValidator,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    validator = module.get<CompletenessWeightValidator>(CompletenessWeightValidator);
  });

  describe('valid weights', () => {
    it('should not throw when Host weights sum to 100', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'PROFILE_COMPLETENESS_WEIGHTS_HOST') {
          return 'name:25,photo:25,business_name:20,payment_method:15,first_property:15';
        }
        return undefined;
      });

      expect(() => validator.validateWeights()).not.toThrow();
    });

    it('should not throw when Cleaner weights sum to 100', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'PROFILE_COMPLETENESS_WEIGHTS_CLEANER') {
          return 'name:15,photo:15,specialties:15,work_zone:15,availability:10,portfolio:10,kyc:10,bio:10';
        }
        return undefined;
      });

      expect(() => validator.validateWeights()).not.toThrow();
    });
  });

  describe('invalid weight sums', () => {
    it('should throw when Host weights sum to 90', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'PROFILE_COMPLETENESS_WEIGHTS_HOST') {
          return 'name:20,photo:20,business_name:20,payment_method:15,first_property:15';
        }
        return undefined;
      });

      expect(() => validator.validateWeights()).toThrow(
        'Profile completeness weights for Host sum to 90, expected 100.',
      );
    });

    it('should throw when Cleaner weights sum to 120', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'PROFILE_COMPLETENESS_WEIGHTS_CLEANER') {
          return 'name:20,photo:20,specialties:20,work_zone:20,availability:10,portfolio:10,kyc:10,bio:10';
        }
        return undefined;
      });

      expect(() => validator.validateWeights()).toThrow(
        'Profile completeness weights for Cleaner sum to 120, expected 100.',
      );
    });
  });

  describe('malformed entries', () => {
    it('should throw when entry is missing colon separator', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'PROFILE_COMPLETENESS_WEIGHTS_HOST') {
          return 'name25,photo:75';
        }
        return undefined;
      });

      expect(() => validator.validateWeights()).toThrow(
        'Invalid completeness weight entry for Host: "name25". Expected format: "field:weight"',
      );
    });

    it('should throw when entry has empty field name', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'PROFILE_COMPLETENESS_WEIGHTS_HOST') {
          return ':25,photo:75';
        }
        return undefined;
      });

      expect(() => validator.validateWeights()).toThrow(
        'Empty field name in completeness weights for Host',
      );
    });

    it('should throw when weight is negative', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'PROFILE_COMPLETENESS_WEIGHTS_HOST') {
          return 'name:-10,photo:110';
        }
        return undefined;
      });

      expect(() => validator.validateWeights()).toThrow(
        'Invalid weight value in completeness weights for Host: "name:-10". Must be a non-negative number.',
      );
    });

    it('should throw when weight is NaN', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'PROFILE_COMPLETENESS_WEIGHTS_CLEANER') {
          return 'name:abc,photo:100';
        }
        return undefined;
      });

      expect(() => validator.validateWeights()).toThrow(
        'Invalid weight value in completeness weights for Cleaner: "name:abc". Must be a non-negative number.',
      );
    });
  });

  describe('missing env vars', () => {
    it('should not throw when both env vars are undefined', () => {
      configService.get.mockReturnValue(undefined);

      expect(() => validator.validateWeights()).not.toThrow();
    });

    it('should not throw when both env vars are empty strings', () => {
      configService.get.mockReturnValue('');

      expect(() => validator.validateWeights()).not.toThrow();
    });
  });

  describe('partial configuration', () => {
    it('should validate only Host when Cleaner is not configured', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'PROFILE_COMPLETENESS_WEIGHTS_HOST') {
          return 'name:50,photo:50';
        }
        return undefined;
      });

      expect(() => validator.validateWeights()).not.toThrow();
    });

    it('should validate only Cleaner when Host is not configured', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'PROFILE_COMPLETENESS_WEIGHTS_CLEANER') {
          return 'name:50,photo:50';
        }
        return undefined;
      });

      expect(() => validator.validateWeights()).not.toThrow();
    });
  });
});
