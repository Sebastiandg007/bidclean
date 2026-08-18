import { ArrayMinSize, IsArray, IsEnum } from 'class-validator';
import { UserRole } from '../roles.types';

/**
 * DTO for assigning roles to a user.
 * At least one role must be selected.
 */
export class AssignRolesDto {
  /** Array of roles to assign (at least one required) */
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one role must be selected' })
  @IsEnum(UserRole, { each: true, message: 'Each role must be "host" or "cleaner"' })
  readonly roles!: UserRole[];
}
