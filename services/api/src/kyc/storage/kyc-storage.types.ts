/**
 * Type definitions for KYC storage service.
 * Describes interfaces for encrypted object storage operations.
 */

/** Result of an image upload operation */
export interface StorageUploadResult {
  readonly key: string;
  readonly bucket: string;
  readonly etag: string;
}

/** Options for uploading an image to encrypted storage */
export interface StorageUploadOptions {
  readonly buffer: Buffer;
  readonly mimeType: string;
  readonly userId: string;
  readonly category: StorageCategory;
}

/** Storage categories for organizing KYC files */
export enum StorageCategory {
  DOCUMENT = 'document',
  SELFIE = 'selfie',
}

/** Options for retrieving a stored image */
export interface StorageRetrieveOptions {
  readonly key: string;
}

/** Options for deleting a stored image */
export interface StorageDeleteOptions {
  readonly key: string;
}
