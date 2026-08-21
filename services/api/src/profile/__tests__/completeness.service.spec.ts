import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CompletenessService } from '../completeness/completeness.service';
import { CompletenessWeightValidator } from '../completeness/completeness-weight.validator';

describe('CompletenessService', () => {
  let service: CompletenessService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompletenessService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: CompletenessWeightValidator, useValue: { validateWeights: jest.fn() } },
      ],
    }).compile();

    service = module.get<CompletenessService>(CompletenessService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateCompleteness', () => {
    it.todo('should calculate host completeness percentage');
    it.todo('should calculate cleaner completeness percentage');
    it.todo('should return 0 when no fields are completed');
    it.todo('should derive portfolio completeness from COUNT(*)');
  });

  describe('onModuleInit', () => {
    it.todo('should validate weights on boot');
    it.todo('should fail fast if weights do not sum to 100');
  });
});
