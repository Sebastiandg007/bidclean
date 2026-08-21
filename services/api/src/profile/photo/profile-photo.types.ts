/**
 * Profile photo types.
 */

/** Signed URL response for accessing a photo */
export interface SignedPhotoUrl {
  readonly url: string;
  readonly expiresAt: Date;
}

/** Supported image MIME types for profile photos */
export type SupportedImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';
