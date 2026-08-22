/**
 * Property photo service type definitions.
 */

/** Allowed photo MIME types */
export const ALLOWED_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedPhotoMimeType = (typeof ALLOWED_PHOTO_MIME_TYPES)[number];

/** Photo upload result */
export interface PhotoUploadResult {
  readonly id: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
  readonly displayOrder: number;
  readonly signedUrl: string;
}

/** Photo reorder request item */
export interface PhotoOrderItem {
  readonly photoId: string;
  readonly displayOrder: number;
}

/** Signed URL with expiration */
export interface SignedPhotoUrl {
  readonly url: string;
  readonly expiresAt: Date;
}
