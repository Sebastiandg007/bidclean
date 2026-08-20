import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { randomUUID } from 'crypto';
import {
  StorageUploadOptions,
  StorageUploadResult,
  StorageDownloadResult,
  StorageDeleteOptions,
  StorageRetrieveOptions,
  StorageCategory,
} from './kyc-storage.types';

/**
 * KYC storage service.
 * Manages encrypted object storage for document and selfie images via MinIO.
 * All images are stored with AES-256 server-side encryption.
 */
@Injectable()
export class KycStorageService implements OnModuleInit {
  private readonly logger = new Logger(KycStorageService.name);
  private readonly minioClient: Minio.Client;
  private readonly bucketName: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.getOrThrow<string>('MINIO_ENDPOINT');
    const parsedUrl = new URL(endpoint);

    this.minioClient = new Minio.Client({
      endPoint: parsedUrl.hostname,
      port: parseInt(parsedUrl.port, 10) || (parsedUrl.protocol === 'https:' ? 443 : 9000),
      useSSL: parsedUrl.protocol === 'https:',
      accessKey: this.configService.getOrThrow<string>('MINIO_ROOT_USER'),
      secretKey: this.configService.getOrThrow<string>('MINIO_ROOT_PASSWORD'),
    });

    this.bucketName = this.configService.getOrThrow<string>('KYC_MINIO_BUCKET');
  }

  /**
   * Ensures the KYC bucket exists on application startup.
   * Creates the bucket if it does not already exist.
   */
  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  /**
   * Upload an image to encrypted storage.
   * Uses AES-256 server-side encryption via MinIO headers.
   */
  async upload(options: StorageUploadOptions): Promise<StorageUploadResult> {
    const key = this.generateStorageKey(options.userId, options.category, options.mimeType);

    this.logger.log(`Uploading file to ${this.bucketName}/${key}`);

    const metadata: Record<string, string> = {
      'Content-Type': options.mimeType,
      'x-amz-server-side-encryption': 'AES256',
    };

    const result = await this.minioClient.putObject(
      this.bucketName,
      key,
      options.buffer,
      options.buffer.length,
      metadata,
    );

    this.logger.log(`Upload complete: ${key} (etag: ${result.etag})`);

    return {
      key,
      bucket: this.bucketName,
      etag: result.etag,
    };
  }

  /**
   * Download a file from storage.
   * Returns the file buffer and its content type for admin review.
   */
  async download(options: StorageRetrieveOptions): Promise<StorageDownloadResult> {
    this.logger.log(`Downloading file: ${this.bucketName}/${options.key}`);

    const stat = await this.minioClient.statObject(this.bucketName, options.key);
    const contentType = stat.metaData?.['content-type'] ?? 'application/octet-stream';

    const stream = await this.minioClient.getObject(this.bucketName, options.key);
    const buffer = await this.streamToBuffer(stream);

    return { buffer, contentType };
  }

  /**
   * Delete a file from storage.
   * Idempotent — succeeds even if the object is already deleted.
   */
  async delete(options: StorageDeleteOptions): Promise<void> {
    this.logger.log(`Deleting file: ${this.bucketName}/${options.key}`);

    try {
      await this.minioClient.removeObject(this.bucketName, options.key);
      this.logger.log(`Deleted: ${options.key}`);
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        this.logger.warn(`Object already deleted (not found): ${options.key}`);
        return;
      }
      throw error;
    }
  }

  /**
   * Generate a structured storage key for organizing files.
   * Format: kyc/{userId}/{category}/{uuid}.{extension}
   */
  generateStorageKey(userId: string, category: StorageCategory, mimeType: string): string {
    const extension = this.mimeTypeToExtension(mimeType);
    const fileId = randomUUID();
    return `kyc/${userId}/${category}/${fileId}.${extension}`;
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
   * Convert a readable stream to a Buffer.
   */
  private streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
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

  /**
   * Map MIME type to file extension.
   */
  private mimeTypeToExtension(mimeType: string): string {
    const mimeMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'image/heif': 'heif',
    };
    return mimeMap[mimeType] ?? 'bin';
  }
}
