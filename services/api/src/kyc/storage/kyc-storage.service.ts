import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StorageUploadOptions,
  StorageUploadResult,
  StorageDeleteOptions,
} from './kyc-storage.types';

/**
 * KYC storage service.
 * Manages encrypted object storage for document and selfie images via MinIO.
 * All images are stored with server-side encryption.
 */
@Injectable()
export class KycStorageService {
  readonly bucketName: string;
  readonly endpoint: string;

  constructor(private readonly configService: ConfigService) {
    this.bucketName = this.configService.getOrThrow<string>('MINIO_KYC_BUCKET');
    this.endpoint = this.configService.getOrThrow<string>('MINIO_ENDPOINT');
  }

  /**
   * Upload an image to encrypted storage.
   * @param options - Upload options including buffer, mime type, and category
   * @returns Upload result with storage key
   */
  async upload(options: StorageUploadOptions): Promise<StorageUploadResult> {
    // TODO: Implement MinIO client upload with server-side encryption
    void options;
    throw new Error('Not implemented');
  }

  /**
   * Delete an image from storage.
   * Idempotent — succeeds even if object is already deleted.
   * @param options - Delete options with storage key
   */
  async delete(options: StorageDeleteOptions): Promise<void> {
    // TODO: Implement MinIO client delete (idempotent)
    void options;
    throw new Error('Not implemented');
  }
}
