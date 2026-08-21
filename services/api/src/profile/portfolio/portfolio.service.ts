import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PortfolioPhoto } from '../entities/portfolio-photo.entity';

/**
 * Portfolio service.
 * Manages portfolio photo uploads, ordering, and deletion for Cleaner users.
 * Portfolio completeness is derived from COUNT(*) — never a stored boolean.
 */
@Injectable()
export class PortfolioService {
  constructor(
    @InjectRepository(PortfolioPhoto)
    private readonly portfolioPhotoRepo: Repository<PortfolioPhoto>,
    private readonly configService: ConfigService,
  ) {}

  async uploadPhoto(_userId: string, _file: Buffer, _mimeType: string): Promise<PortfolioPhoto> {
    void this.configService;
    throw new NotImplementedException();
  }

  async deletePhoto(_userId: string, _photoId: string): Promise<void> {
    throw new NotImplementedException();
  }

  async getPhotos(_userId: string): Promise<PortfolioPhoto[]> {
    throw new NotImplementedException();
  }

  async getPhotoCount(userId: string): Promise<number> {
    return this.portfolioPhotoRepo.count({ where: { userId } });
  }
}
