import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Body for `POST /video-verifications/:id/finalize`.
 *
 * `objectKey` identifies the uploaded object; `durationMs`/`sizeBytes`/`mimeType` are ADVISORY UX
 * values only — the server re-inspects the object and its server-observed size/content-type/duration
 * are authoritative. Declared metadata never overrides the server-observed values.
 */
export class FinalizeUploadDto {
  @IsString()
  objectKey!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;

  @IsOptional()
  @IsString()
  mimeType?: string;
}
