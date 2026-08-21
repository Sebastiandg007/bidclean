import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PortfolioService } from '../portfolio/portfolio.service';
import { PortfolioPhoto } from '../entities/portfolio-photo.entity';

describe('PortfolioService', () => {
  let service: PortfolioService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        { provide: getRepositoryToken(PortfolioPhoto), useValue: { count: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadPhoto', () => {
    it.todo('should upload portfolio photo to MinIO');
    it.todo('should reject when max portfolio count reached');
  });

  describe('deletePhoto', () => {
    it.todo('should delete photo from MinIO and database');
    it.todo('should throw NotFoundException for non-existent photo');
  });

  describe('getPhotoCount', () => {
    it.todo('should return count of portfolio photos for user');
  });
});
