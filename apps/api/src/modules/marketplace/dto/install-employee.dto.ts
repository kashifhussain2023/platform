import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { InstallEmployeeDto as IInstallEmployeeDto } from '@vaep/types';

/** POST /marketplace/employees/:key/install body. Optional name override. */
export class InstallEmployeeDto implements IInstallEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
}
