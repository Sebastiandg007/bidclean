import { IsEnum } from 'class-validator';
import { UserRole } from '../roles.types';

/**
 * DTO for switching the user's active role.
 * The role must be a valid UserRole enum value.
 */
export class SwitchActiveRoleDto {
  /** The role to switch to (must be 'host' or 'cleaner') */
  @IsEnum(UserRole, { message: "Invalid role. Must be 'host' or 'cleaner'" })
  readonly activeRole!: UserRole;
}
