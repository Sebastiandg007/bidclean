/**
 * DTO for photo upload metadata.
 * Actual file is handled via multipart upload.
 */
export class UploadPhotoDto {
  /** Optional caption for portfolio photos */
  caption?: string;
}
