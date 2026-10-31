import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import { DisputeEvidenceKind } from '../dispute.types';

/** The structured evidence kinds a participant may submit directly (never a reference/photo kind). */
const SUBMITTABLE_STRUCTURED_KINDS: readonly string[] = [
  DisputeEvidenceKind.HOST_REASON,
  DisputeEvidenceKind.NOTE,
];

/**
 * Body for `POST /disputes/:id/evidence`.
 *
 * `{ kind, textValue }` — a structured Host/Cleaner submission (`HOST_REASON`/`NOTE` only). The text
 * is user content: length-bounded here, validated/escaped downstream, never executed.
 */
export class AddStructuredEvidenceDto {
  @IsIn(SUBMITTABLE_STRUCTURED_KINDS)
  readonly kind!: DisputeEvidenceKind.HOST_REASON | DisputeEvidenceKind.NOTE;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  readonly textValue!: string;
}
