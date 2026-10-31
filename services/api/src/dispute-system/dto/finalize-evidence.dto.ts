import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `POST /disputes/:id/evidence/finalize`.
 *
 * Only `objectKey` is authoritative (resolved against a server-issued grant + server-inspected). Any
 * client-declared size/type is advisory and re-inspected server-side, so it is not accepted here.
 */
export class FinalizeEvidenceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  readonly objectKey!: string;
}
