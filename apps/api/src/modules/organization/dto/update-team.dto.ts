import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { UpdateTeamDto as IUpdateTeamDto } from '@vaep/types';

/** PATCH /teams/:id body (optional name / departmentId). Mirrors the contract. */
export class UpdateTeamDto implements IUpdateTeamDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  // @IsOptional() also skips validation for an explicit null (unassigns department).
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  departmentId?: string | null;
}
