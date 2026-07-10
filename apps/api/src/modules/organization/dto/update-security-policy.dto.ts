import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { UpdateSecurityPolicyDto as IUpdateSecurityPolicyDto } from '@vaep/types';

/**
 * PATCH /security-policy body (all fields optional). Mirrors the shared contract.
 * passwordMinLength floor is 8 (the create-user DTO also enforces a hard 8-char
 * minimum). mfaRequired / sessionTimeoutMinutes / dataRetentionDays are STORED
 * only today (enforcement is a documented TODO).
 */
export class UpdateSecurityPolicyDto implements IUpdateSecurityPolicyDto {
  @IsOptional()
  @IsInt()
  @Min(8)
  @Max(128)
  passwordMinLength?: number;

  @IsOptional()
  @IsBoolean()
  mfaRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sessionTimeoutMinutes?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  allowedEmailDomains?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  dataRetentionDays?: number;
}
