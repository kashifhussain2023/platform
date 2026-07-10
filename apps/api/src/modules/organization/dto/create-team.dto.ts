import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { CreateTeamDto as ICreateTeamDto } from '@vaep/types';

/** POST /teams body (optional departmentId). Mirrors the shared contract. */
export class CreateTeamDto implements ICreateTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  // @IsOptional() also skips validation for an explicit null (no department).
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  departmentId?: string | null;
}
