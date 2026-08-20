import { IsNotEmpty, IsString, IsEnum, IsOptional } from 'class-validator';
import { DocumentType } from '../kyc.types';

/**
 * DTO for uploading an identity document image.
 * File is received via multipart/form-data; this validates the metadata.
 */
export class UploadDocumentDto {
  /** Type of identity document being uploaded */
  @IsNotEmpty()
  @IsEnum(DocumentType, {
    message: 'documentType must be one of: PASSPORT, NATIONAL_ID, DRIVERS_LICENSE',
  })
  readonly documentType!: DocumentType;

  /** Optional idempotency key to prevent duplicate uploads */
  @IsOptional()
  @IsString()
  readonly idempotencyKey?: string;
}
