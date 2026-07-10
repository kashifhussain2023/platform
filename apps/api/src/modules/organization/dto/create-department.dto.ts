import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { CreateDepartmentDto as ICreateDepartmentDto } from '@vaep/types';

/** POST /departments body. Mirrors the shared @vaep/types contract. */
export class CreateDepartmentDto implements ICreateDepartmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
