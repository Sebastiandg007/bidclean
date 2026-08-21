import {
  Injectable,
  Logger,
  BadRequestException,
  PayloadTooLargeException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { PortfolioPhoto } from '../entities/portfolio-photo.entity';
import { PortfolioPhotoWithUrl, PortfolioUploadResult } from './portfolio.types';

/** Supported MIME types mapped to file extensions */
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Set of supported MIME types for validation */
const SUPPORTED_MIME_TYPES = new Set<string>(Object.keys(MIME_TO_EXTENSION));

/**
 * Portfolio service.
 * Manages portfolio photo uploads, ordering, and deletion for Cleaner users.
 * Portfolio completeness is derived from COUNT(*) — never a stored boolean.
 */
@Injectable()
export class PortfolioService implements OnModuleInit {
  private readonly logger = new Logger(PortfolioService.name);
  private readonly minioClient: Minio.Client;
  private readonly bucketName: string;
  private readonly maxSizeBytes: number;
  private readonly maxDimensionPx: number;
  private readonly maxPhotos: number;
  private readonly urlExpirySeconds: number;

  constructor(
    @InjectRepository(PortfolioPhoto)
    private readonly portfolioPhotoRepo: Repository<PortfolioPhoto>,
    private readonly configService: ConfigService,
  ) {
    const endpoint = this.configService.getOrThrow<string>('MINIO_ENDPOINT');
    const parsedUrl = new URL(endpoint);

    this.minioClient = new Minio.Client({
      endPoint: parsedUrl.hostname,
      port: parseInt(parsedUrl.port, 10) || (parsedUrl.protocol === 'https:' ? 443 : 9000),
      useSSL: parsedUrl.protocol === 'https:',
      accessKey: this.configService.getOrThrow<string>('MINIO_ROOT_USER'),
      secretKey: this.configService.getOrThrow<string>('MINIO_ROOT_PASSWORD'),
    });

    this.bucketName = this.configService.getOrThrow<string>('MINIO_PROFILE_PHOTOS_BUCKET');

    const maxSizeMb = Number(this.configService.getOrThrow<string>('PROFILE_PHOTO_MAX_SIZE_MB'));
    this.maxSizeBytes = maxSizeMb * 1024 * 1024;

    this.maxDimensionPx = Number(
      this.configService.getOrThrow<string>('PROFILE_PHOTO_MAX_DIMENSION_PX'),
    );

    this.maxPhotos = Number(
      this.configService.getOrThrow<string>('PROFILE_MAX_PORTFOLIO_PHOTOS'),
    );

    this.urlExpirySeconds = Number(
      this.configService.getOrThrow<string>('PROFILE_PHOTO_URL_EXPIRY_SECONDS'),
    );
  }

  /**
   * Ensures the portfolio photos bucket exists on application startup.
   */
  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  /**
   * Upload a portfolio photo for a Cleaner user.
   * Validates format, size, max count, resizes, uploads to MinIO with encryption,
   * and assigns the next display_order.
   * @param userId - The user's internal ID
   * @param file - Raw image buffer
   * @param mimeType - MIME type of the uploaded file
   * @param caption - Optional photo caption
   * @returns The created portfolio photo record with signed URL
   */
  async uploadPhoto(
    userId: string,
    file: Buffer,
    mimeType: string,
    caption?: string | null,
  ): Promise<PortfolioUploadResult> {
    this.validateMimeType(mimeType);
    this.validateFileSize(file);
    await this.validateMaxCount(userId);

    const resizedBuffer = await this.resizeImage(file);
    const photoId = randomUUID();
    const storageKey = this.generateStorageKey(userId, photoId, mimeType);
    const displayOrder = await this.getNextDisplayOrder(userId);

    await this.uploadToMinio(storageKey, resizedBuffer, mimeType);

    const photo = this.portfolioPhotoRepo.create({
      userId,
      storageKey,
      displayOrder,
      caption: caption ?? null,
    });

    const savedPhoto = await this.portfolioPhotoRepo.save(photo);
    const url = await this.generateSignedUrl(storageKey);

    this.logger.log(`Portfolio photo uploaded for user ${userId}: ${storageKey}`);

    return {
      id: savedPhoto.id,
      url,
      displayOrder: savedPhoto.displayOrder,
      caption: savedPhoto.caption,
      createdAt: savedPhoto.createdAt,
    };
  }

  /**
   * Delete a portfolio photo from MinIO and the database.
   * Validates ownership before deletion. Idempotent for MinIO removal.
   * @param userId - The user's internal ID
   * @param photoId - The portfolio photo's UUID
   */
  async deletePhoto(userId: string, photoId: string): Promise<void> {
    const photo = await this.findPhotoOrFail(userId, photoId);

    await this.removeObjectSafe(photo.storageKey);
    await this.portfolioPhotoRepo.remove(photo);

    this.logger.log(`Portfolio photo deleted for user ${userId}: ${photo.storageKey}`);
  }

  /**
   * Get all portfolio photos for a user, ordered by display_order.
   * Returns photos with signed URLs for display.
   * @param userId - The user's internal ID
   * @returns Array of portfolio photos with signed URLs
   */
  async getPhotos(userId: string): Promise<PortfolioPhotoWithUrl[]> {
    const photos = await this.portfolioPhotoRepo.find({
      where: { userId },
      order: { displayOrder: 'ASC' },
    });

    return Promise.all(
      photos.map(async (photo) => ({
        id: photo.id,
        url: await this.generateSignedUrl(photo.storageKey),
        displayOrder: photo.displayOrder,
        caption: photo.caption,
        createdAt: photo.createdAt,
      })),
    );
  }

  /**
   * Get the count of portfolio photos for a user.
   * Used by the completeness service to derive portfolio completeness from COUNT(*).
   * @param userId - The user's internal ID
   * @returns Number of portfolio photos
   */
  async getPhotoCount(userId: string): Promise<number> {
    return this.portfolioPhotoRepo.count({ where: { userId } });
  }

  /**
   * Generate a signed URL for a portfolio photo storage key.
   * @param storageKey - The MinIO object key
   * @returns Signed URL string
   */
  async generateSignedUrl(storageKey: string): Promise<string> {
    return this.minioClient.presignedGetObject(
      this.bucketName,
      storageKey,
      this.urlExpirySeconds,
    );
  }

  // --- Private helpers ---

  /** Validates that the MIME type is supported (JPEG, PNG, WebP). */
  private validateMimeType(mimeType: string): void {
    if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException('profile.error.invalid_photo_type');
    }
  }

  /** Validates that the file does not exceed the configured max size. */
  private validateFileSize(file: Buffer): void {
    if (file.length > this.maxSizeBytes) {
      throw new PayloadTooLargeException('profile.error.photo_too_large');
    }
  }

  /** Validates that the user has not reached the max portfolio photo count. */
  private async validateMaxCount(userId: string): Promise<void> {
    const currentCount = await this.portfolioPhotoRepo.count({ where: { userId } });
    if (currentCount >= this.maxPhotos) {
      throw new BadRequestException('profile.error.portfolio_max');
    }
  }

  /** Resize image to fit within the configured max dimension. */
  private async resizeImage(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .resize(this.maxDimensionPx, this.maxDimensionPx, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer();
  }

  /** Generates storage key: {userId}/portfolio/{photoId}.{extension} */
  private generateStorageKey(userId: string, photoId: string, mimeType: string): string {
    const extension = MIME_TO_EXTENSION[mimeType] ?? 'jpg';
    return `${userId}/portfolio/${photoId}.${extension}`;
  }

  /** Calculates the next display_order for a user's portfolio (max + 1). */
  private async getNextDisplayOrder(userId: string): Promise<number> {
    const result = await this.portfolioPhotoRepo
      .createQueryBuilder('photo')
      .select('MAX(photo.displayOrder)', 'maxOrder')
      .where('photo.userId = :userId', { userId })
      .getRawOne<{ maxOrder: number | null }>();

    return (result?.maxOrder ?? -1) + 1;
  }

  /** Upload buffer to MinIO with AES-256 server-side encryption. */
  private async uploadToMinio(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    const metadata: Record<string, string> = {
      'Content-Type': mimeType,
      'x-amz-server-side-encryption': 'AES256',
    };

    await this.minioClient.putObject(this.bucketName, key, buffer, buffer.length, metadata);
  }

  /** Find a portfolio photo by ID, validating ownership. Throws if not found. */
  private async findPhotoOrFail(userId: string, photoId: string): Promise<PortfolioPhoto> {
    const photo = await this.portfolioPhotoRepo.findOne({
      where: { id: photoId, userId },
    });

    if (!photo) {
      throw new NotFoundException('profile.error.photo_not_found');
    }

    return photo;
  }

  /** Remove an object from MinIO. Idempotent — handles already-deleted objects. */
  private async removeObjectSafe(key: string): Promise<void> {
    try {
      await this.minioClient.removeObject(this.bucketName, key);
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        this.logger.warn(`Object already deleted (not found): ${key}`);
        return;
      }
      throw error;
    }
  }

  /** Creates the bucket if it doesn't exist. */
  private async ensureBucketExists(): Promise<void> {
    const exists = await this.minioClient.bucketExists(this.bucketName);
    if (!exists) {
      this.logger.log(`Creating bucket: ${this.bucketName}`);
      await this.minioClient.makeBucket(this.bucketName);
    }
  }

  /** Determine if an error represents a "not found" condition in MinIO. */
  private isNotFoundError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      return code === 'NoSuchKey' || code === 'NotFound';
    }
    return false;
  }
}
