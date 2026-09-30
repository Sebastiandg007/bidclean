import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import { TaskPhotoKind } from '../checklist.types';

/**
 * Body for `POST /service-sessions/:id/checklist/tasks/:taskId/photo/finalize`.
 *
 * `{ objectKey, kind?, sizeBytes?, mimeType?, width?, height? }`. Everything except `objectKey` is
 * ADVISORY — the server re-inspects the object (size/content-type/dimensions authoritative) and
 * resolves the grant. The declared metadata never overrides server-observed values.
 */
export class FinalizePhotoDto {
  @IsString()
  @MaxLength(512)
  readonly objectKey!: string;

  @IsOptional()
  @IsIn([TaskPhotoKind.BEFORE, TaskPhotoKind.AFTER, TaskPhotoKind.GENERAL])
  readonly kind?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  readonly sizeBytes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  readonly mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  readonly width?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  readonly height?: number;
}
