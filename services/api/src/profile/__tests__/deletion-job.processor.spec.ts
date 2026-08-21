import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DeletionJobProcessor } from '../account/deletion-job.processor';

describe('DeletionJobProcessor', () => {
  let processor: DeletionJobProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeletionJobProcessor,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    processor = module.get<DeletionJobProcessor>(DeletionJobProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process', () => {
    it.todo('should execute deletion cascade in correct order');
    it.todo('should be idempotent on retry');
    it.todo('should log audit entries for each step');
    it.todo('should anonymize PII in database');
  });
});
