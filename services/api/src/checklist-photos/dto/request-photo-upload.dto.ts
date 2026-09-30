import { IsIn, IsOptional } from 'class-validator';

import { TaskPhotoKind } from '../checklist.types';

/**
 * Optional body for `POST /service-sessions/:id/checklist/tasks/:taskId/photo/request-upload`.
 *
 * The upload target is fully determined by the path (`:id`, `:taskId`) and the server-generated
 * object key; the only optional hint is the intended `kind`, which is purely advisory (the kind is
 * re-declared and re-validated at finalize). No security-sensitive value is accepted here.
 */
export class RequestPhotoUploadDto {
  @IsOptional()
  @IsIn([TaskPhotoKind.BEFORE, TaskPhotoKind.AFTER, TaskPhotoKind.GENERAL])
  readonly kind?: string;
}
