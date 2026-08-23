import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
  PayloadTooLargeException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { PropertyPhoto } from '../entities/property-photo.entity';
import {
  ALLOWED_PHOTO_MIME_TYPES,
  PhotoUploadResult,
  SignedPhotoUrl,
} from './property-photo.types';

/** Map of supported MIME types to file extensions */
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Set of supported MIME types for fast lookup */
const SUPPORTED_MIME_TYPES = new Set<string>(ALLOWED_PHOTO_MIME_TYPES);

/** Bytes per megabyte for size conversion */
const BYTES_PER_MB = 1024 * 1024;

/** Milliseconds per second for expiry calculation */
const MS_PER_SECOND = 1000;

/** Default HTTPS port */
const DEFAULT_HTTPS_PORT = 443;

/** Default MinIO port */
const DEFAULT_MINIO_PORT = 9000;

/**
 * Property photo service.
 * Handles photo upload (MinIO with AES-256 encryption), resize (sharp),
 * signed URL generation, deletion, max count validation,
 * and transactional display_order management with SELECT FOR UPDATE.
 *
 * Stores mime_type and file_size_bytes alongside storage reference
 * for auditing and validation.
 */
@Injectable()
export class PropertyPhotoService implements OnModuleInit {
  private readonly logger = new Logger(PropertyPhotoService.name);
  private readonly minioClient: Minio.Client;
  private readonly bucketName: string;
  private readonly maxSizeBytes: number;
  private readonly maxDimensionPx: number;
  private readonly maxPhotos: number;
  private readonly urlExpirySeconds: number;

  constructor(
    @InjectRepository(PropertyPhoto)
    private readonly photoRepo: Repository<PropertyPhoto>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    const endpoint = this.configService.getOrThrow<string>('MINIO_ENDPOINT');
    const parsedUrl = new URL(endpoint);

    this.minioClient = new Minio.Client({
      endPoint: parsedUrl.hostname,
      port: parseInt(parsedUrl.port, 10) || (parsedUrl.protocol === 'https:' ? DEFAULT_HTTPS_PORT : DEFAULT_MINIO_PORT),
      useSSL: parsedUrl.protocol === 'https:',
      accessKey: this.configService.getOrThrow<string>('MINIO_ROOT_USER'),
      secretKey: this.configService.getOrThrow<string>('MINIO_ROOT_PASSWORD'),
    });

    this.bucketName = this.configService.getOrThrow<string>('MINIO_PROPERTY_PHOTOS_BUCKET');

    const maxSizeMb = Number(
      this.configService.getOrThrow<string>('PROPERTY_PHOTO_MAX_SIZE_MB'),
    );
    this.maxSizeBytes = maxSizeMb * BYTES_PER_MB;

    this.maxDimensionPx = Number(
      this.configService.getOrThrow<string>('PROPERTY_PHOTO_MAX_DIMENSION_PX'),
    );

    this.maxPhotos = Number(
      this.configService.getOrThrow<string>('PROPERTY_MAX_PHOTOS'),
    );

    this.urlExpirySeconds = Number(
      this.configService.getOrThrow<string>('PROPERTY_PHOTO_URL_EXPIRY_SECONDS'),
    );
  }

  /**
   * Ensures the property photos bucket exists on application startup.
   */
  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  /**
   * Upload a photo for a property.
   * Validates format, size, and max count. Resizes the image, uploads to MinIO
   * with AES-256 encryption, and saves the entity with mime_type, file_size_bytes,
   * and the next contiguous display_order.
   *
   * Supports idempotency via optional key — returns existing photo if already uploaded.
   *
   * @param propertyId - The property's UUID
   * @param file - Raw image buffer
   * @param mimeType - MIME type of the uploaded file
   * @param idempotencyKey - Optional key for idempotent uploads
   * @returns Upload result with signed URL
   */
  async uploadPhoto(
    propertyId: string,
    file: Buffer,
    mimeType: string,
    idempotencyKey?: string,
  ): Promise<PhotoUploadResult> {
    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(propertyId, idempotencyKey);
      if (existing) {
        return this.toUploadResult(existing);
      }
    }

    this.validateMimeType(mimeType);
    this.validateFileSize(file);
    await this.validateMaxCount(propertyId);

    const resizedBuffer = await this.resizeImage(file);
    const photoId = randomUUID();
    const storageKey = this.generateStorageKey(propertyId, photoId, mimeType);
    const displayOrder = await this.getNextDisplayOrder(propertyId);

    await this.uploadToMinio(storageKey, resizedBuffer, mimeType);

    const photo = this.photoRepo.create({
      id: photoId,
      propertyId,
      storageKey,
      mimeType,
      fileSizeBytes: resizedBuffer.length,
      displayOrder,
    });

    const savedPhoto = await this.photoRepo.save(photo);
    const signedUrl = await this.getSignedUrl(storageKey);

    this.logger.log(`Photo uploaded for property ${propertyId}: ${storageKey}`);

    return {
      id: savedPhoto.id,
      storageKey: savedPhoto.storageKey,
      mimeType: savedPhoto.mimeType,
      fileSizeBytes: savedPhoto.fileSizeBytes,
      displayOrder: savedPhoto.displayOrder,
      signedUrl: signedUrl.url,
    };
  }

  /**
   * Delete a property photo.
   * Executes within a TRANSACTION using SELECT FOR UPDATE to prevent concurrent
   * corruption. Removes from MinIO (idempotent), deletes from DB, and renumbers
   * remaining photos to maintain contiguous order (0, 1, 2, ...).
   *
   * @param propertyId - The property's UUID
   * @param photoId - The photo's UUID
   */
  async deletePhoto(propertyId: string, photoId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const photos = await manager
        .createQueryBuilder(PropertyPhoto, 'photo')
        .setLock('pessimistic_write')
        .where('photo.propertyId = :propertyId', { propertyId })
        .orderBy('photo.displayOrder', 'ASC')
        .getMany();

      const target = photos.find((p) => p.id === photoId);
      if (!target) {
        throw new NotFoundException('property.error.photo_not_found');
      }

      await this.removeObjectSafe(target.storageKey);
      await manager.remove(PropertyPhoto, target);

      const remaining = photos.filter((p) => p.id !== photoId);
      await this.renumberPhotos(manager, remaining);
    });

    this.logger.log(`Photo ${photoId} deleted from property ${propertyId}`);
  }

  /**
   * Reorder photos for a property.
   * Executes within a TRANSACTION using SELECT FOR UPDATE. Updates display_order
   * based on the position of each photo ID in the provided array.
   *
   * @param propertyId - The property's UUID
   * @param orderedPhotoIds - Array of photo IDs in desired order
   */
  async reorderPhotos(propertyId: string, orderedPhotoIds: string[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const photos = await manager
        .createQueryBuilder(PropertyPhoto, 'photo')
        .setLock('pessimistic_write')
        .where('photo.propertyId = :propertyId', { propertyId })
        .getMany();

      this.validateReorderIds(photos, orderedPhotoIds);

      const photoMap = new Map(photos.map((p) => [p.id, p]));

      for (let i = 0; i < orderedPhotoIds.length; i++) {
        const photoId = orderedPhotoIds[i]!;
        const photo = photoMap.get(photoId)!;
        photo.displayOrder = i;
      }

      await manager.save(PropertyPhoto, photos);
    });

    this.logger.log(`Photos reordered for property ${propertyId}`);
  }

  /**
   * Generate a presigned GET URL for a stored photo.
   * @param storageKey - The MinIO object key
   * @returns Signed URL with expiration date
   */
  async getSignedUrl(storageKey: string): Promise<SignedPhotoUrl> {
    const url = await this.minioClient.presignedGetObject(
      this.bucketName,
      storageKey,
      this.urlExpirySeconds,
    );

    const expiresAt = new Date(Date.now() + this.urlExpirySeconds * MS_PER_SECOND);
    return { url, expiresAt };
  }

  /**
   * Get the count of photos for a property.
   * @param propertyId - The property's UUID
   * @returns Number of photos
   */
  async getPhotoCount(propertyId: string): Promise<number> {
    return this.photoRepo.count({ where: { propertyId } });
  }

  /**
   * Get all photos for a property with signed URLs, ordered by display_order ASC.
   * @param propertyId - The property's UUID
   * @returns Array of photos with signed URLs
   */
  async getPhotosWithUrls(
    propertyId: string,
  ): Promise<(PhotoUploadResult & { createdAt: Date })[]> {
    const photos = await this.photoRepo.find({
      where: { propertyId },
      order: { displayOrder: 'ASC' },
    });

    return Promise.all(
      photos.map(async (photo) => {
        const { url } = await this.getSignedUrl(photo.storageKey);
        return {
          id: photo.id,
          storageKey: photo.storageKey,
          mimeType: photo.mimeType,
          fileSizeBytes: photo.fileSizeBytes,
          displayOrder: photo.displayOrder,
          signedUrl: url,
          createdAt: photo.createdAt,
        };
      }),
    );
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /** Validates that the MIME type is one of JPEG, PNG, or WebP. */
  private validateMimeType(mimeType: string): void {
    if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException('property.error.invalid_photo_format');
    }
  }

  /** Validates that the file does not exceed the configured max size. */
  private validateFileSize(file: Buffer): void {
    if (file.length > this.maxSizeBytes) {
      throw new PayloadTooLargeException('property.error.photo_too_large');
    }
  }

  /** Validates that the property has not reached the max photo count. */
  private async validateMaxCount(propertyId: string): Promise<void> {
    const currentCount = await this.photoRepo.count({ where: { propertyId } });
    if (currentCount >= this.maxPhotos) {
      throw new BadRequestException('property.error.max_photos_reached');
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

  /** Generates storage key: {propertyId}/{photoId}.{extension} */
  private generateStorageKey(propertyId: string, photoId: string, mimeType: string): string {
    const extension = MIME_TO_EXTENSION[mimeType] ?? 'jpg';
    return `${propertyId}/${photoId}.${extension}`;
  }

  /** Calculates the next display_order for a property's photos (max + 1). */
  private async getNextDisplayOrder(propertyId: string): Promise<number> {
    const result = await this.photoRepo
      .createQueryBuilder('photo')
      .select('MAX(photo.displayOrder)', 'maxOrder')
      .where('photo.propertyId = :propertyId', { propertyId })
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

  /** Find an existing photo by idempotency key (storageKey prefix match). */
  private async findByIdempotencyKey(
    propertyId: string,
    idempotencyKey: string,
  ): Promise<PropertyPhoto | null> {
    return this.photoRepo.findOne({
      where: { propertyId, storageKey: `${propertyId}/${idempotencyKey}` },
    });
  }

  /** Convert a PropertyPhoto entity to a PhotoUploadResult with signed URL. */
  private async toUploadResult(photo: PropertyPhoto): Promise<PhotoUploadResult> {
    const { url } = await this.getSignedUrl(photo.storageKey);
    return {
      id: photo.id,
      storageKey: photo.storageKey,
      mimeType: photo.mimeType,
      fileSizeBytes: photo.fileSizeBytes,
      displayOrder: photo.displayOrder,
      signedUrl: url,
    };
  }

  /** Renumber photos contiguously starting from 0. */
  private async renumberPhotos(
    manager: import('typeorm').EntityManager,
    photos: PropertyPhoto[],
  ): Promise<void> {
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]!;
      photo.displayOrder = i;
    }

    if (photos.length > 0) {
      await manager.save(PropertyPhoto, photos);
    }
  }

  /** Validate that all provided IDs exist in the property's photos. */
  private validateReorderIds(photos: PropertyPhoto[], orderedIds: string[]): void {
    const existingIds = new Set(photos.map((p) => p.id));

    for (const id of orderedIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException('property.error.photo_not_found');
      }
    }

    if (orderedIds.length !== photos.length) {
      throw new BadRequestException('property.error.photo_not_found');
    }
  }
}
