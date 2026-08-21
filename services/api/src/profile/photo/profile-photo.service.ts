import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import sharp from 'sharp';
import { SignedPhotoUrl, SupportedImageMimeType } from './profile-photo.types';
import { ProfileRepository } from '../profile.repository';

/** Map of supported MIME types to file extensions */
const MIME_TO_EXTENSION: Record<SupportedImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Set of supported MIME types for fast lookup */
const SUPPORTED_MIME_TYPES = new Set<string>(Object.keys(MIME_TO_EXTENSION));

/**
 * Profile photo service.
 * Handles photo upload to MinIO with AES-256 encryption, resize via sharp,
 * signed URL generation with configurable expiry, and old photo deletion on replacement.
 */
@Injectable()
export class ProfilePhotoService implements OnModuleInit {
  private readonly logger = new Logger(ProfilePhotoService.name);
  private readonly minioClient: Minio.Client;
  private readonly bucketName: string;
  private readonly maxSizeBytes: number;
  private readonly maxDimensionPx: number;
  private readonly urlExpirySeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly profileRepository: ProfileRepository,
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

    this.urlExpirySeconds = Number(
      this.configService.getOrThrow<string>('PROFILE_PHOTO_URL_EXPIRY_SECONDS'),
    );
  }

  /**
   * Ensures the profile photos bucket exists on application startup.
   */
  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  /**
   * Upload a profile photo for a user.
   * Validates format and size, resizes the image, deletes old photo if present,
   * uploads to MinIO with AES-256 encryption, and updates the profile record.
   * @param userId - The user's ID
   * @param file - Raw image buffer
   * @param mimeType - MIME type of the uploaded file
   * @returns The storage key of the uploaded photo
   */
  async uploadPhoto(userId: string, file: Buffer, mimeType: string): Promise<string> {
    this.validateMimeType(mimeType);
    this.validateFileSize(file);

    const resizedBuffer = await this.resizeImage(file);
    const storageKey = this.generateStorageKey(userId, mimeType as SupportedImageMimeType);

    await this.deleteOldPhotoIfExists(userId);
    await this.uploadToMinio(storageKey, resizedBuffer, mimeType);
    await this.profileRepository.updateProfile(userId, { photoStorageKey: storageKey });

    this.logger.log(`Photo uploaded for user ${userId}: ${storageKey}`);
    return storageKey;
  }

  /**
   * Delete a user's profile photo from MinIO and clear the storage key.
   * Idempotent — succeeds even if the object is already deleted.
   * @param userId - The user's ID
   */
  async deletePhoto(userId: string): Promise<void> {
    const profile = await this.profileRepository.findByUserIdOrFail(userId);

    if (profile.photoStorageKey) {
      await this.removeObjectSafe(profile.photoStorageKey);
      await this.profileRepository.updateProfile(userId, { photoStorageKey: null });
      this.logger.log(`Photo deleted for user ${userId}`);
    }
  }

  /**
   * Generate a signed URL for accessing a stored photo.
   * @param storageKey - The MinIO object key
   * @returns Signed URL with expiry date
   */
  async getSignedUrl(storageKey: string): Promise<SignedPhotoUrl> {
    const url = await this.minioClient.presignedGetObject(
      this.bucketName,
      storageKey,
      this.urlExpirySeconds,
    );

    const expiresAt = new Date(Date.now() + this.urlExpirySeconds * 1000);

    return { url, expiresAt };
  }

  /**
   * Validates that the MIME type is supported.
   */
  private validateMimeType(mimeType: string): void {
    if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException('profile.error.unsupported_image_format');
    }
  }

  /**
   * Validates that the file does not exceed the configured max size.
   */
  private validateFileSize(file: Buffer): void {
    if (file.length > this.maxSizeBytes) {
      throw new PayloadTooLargeException('profile.error.file_too_large');
    }
  }

  /**
   * Resize the image to fit within the configured max dimension.
   * Maintains aspect ratio and does not enlarge smaller images.
   */
  private async resizeImage(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .resize(this.maxDimensionPx, this.maxDimensionPx, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer();
  }

  /**
   * Generates a storage key in the format: {userId}/avatar.{extension}
   */
  private generateStorageKey(userId: string, mimeType: SupportedImageMimeType): string {
    const extension = MIME_TO_EXTENSION[mimeType];
    return `${userId}/avatar.${extension}`;
  }

  /**
   * Deletes the old photo from MinIO if the user already has one.
   */
  private async deleteOldPhotoIfExists(userId: string): Promise<void> {
    const profile = await this.profileRepository.findByUserId(userId);

    if (profile?.photoStorageKey) {
      await this.removeObjectSafe(profile.photoStorageKey);
      this.logger.log(`Old photo removed for user ${userId}: ${profile.photoStorageKey}`);
    }
  }

  /**
   * Upload buffer to MinIO with AES-256 server-side encryption.
   */
  private async uploadToMinio(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    const metadata: Record<string, string> = {
      'Content-Type': mimeType,
      'x-amz-server-side-encryption': 'AES256',
    };

    await this.minioClient.putObject(
      this.bucketName,
      key,
      buffer,
      buffer.length,
      metadata,
    );
  }

  /**
   * Remove an object from MinIO. Idempotent — handles already-deleted objects.
   */
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

  /**
   * Creates the bucket if it doesn't exist.
   */
  private async ensureBucketExists(): Promise<void> {
    const exists = await this.minioClient.bucketExists(this.bucketName);
    if (!exists) {
      this.logger.log(`Creating bucket: ${this.bucketName}`);
      await this.minioClient.makeBucket(this.bucketName);
      this.logger.log(`Bucket created: ${this.bucketName}`);
    } else {
      this.logger.log(`Bucket already exists: ${this.bucketName}`);
    }
  }

  /**
   * Determine if an error represents a "not found" condition in MinIO.
   */
  private isNotFoundError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      return code === 'NoSuchKey' || code === 'NotFound';
    }
    return false;
  }
}
