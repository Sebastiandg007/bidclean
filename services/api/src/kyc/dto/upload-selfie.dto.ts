import { IsOptional, IsString } from 'class-validator';

/**
 * DTO for uploading a selfie image.
 * File is received via multipart/form-data; this validates the metadata.
 */
export class UploadSelfieDto {
  /** Optional idempotency key to prevent duplicate uploads */
  @IsOptional()
  @IsString()
  readonly idempotencyKey?: string;
}
