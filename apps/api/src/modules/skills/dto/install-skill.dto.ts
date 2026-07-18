import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { InstallSkillDto as IInstallSkillDto } from '@vaep/types';

/** POST /skills/install body. Mirrors the shared @vaep/types contract. */
export class InstallSkillDto implements IInstallSkillDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  skillKey!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  employeeId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
