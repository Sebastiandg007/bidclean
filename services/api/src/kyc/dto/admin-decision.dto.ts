import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Possible admin decisions on a KYC verification */
export enum AdminDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

/**
 * DTO for admin KYC decision (approve or reject a verification).
 */
export class AdminDecisionDto {
  /** Admin decision: approve or reject */
  @IsNotEmpty()
  @IsEnum(AdminDecision, {
    message: 'decision must be one of: APPROVE, REJECT',
  })
  readonly decision!: AdminDecision;

  /** Reason for rejection (required when decision is REJECT) */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly rejectionReason?: string;
}
