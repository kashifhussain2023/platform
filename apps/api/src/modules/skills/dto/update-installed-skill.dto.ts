import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { UpdateInstalledSkillDto as IUpdateInstalledSkillDto } from '@vaep/types';

/** PATCH /skills/installed/:id body. Mirrors the shared @vaep/types contract. */
export class UpdateInstalledSkillDto implements IUpdateInstalledSkillDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
