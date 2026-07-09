import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  EMPLOYEE_STATUSES,
  type EmployeeStatus,
  type UpdateEmployeeDto as IUpdateEmployeeDto,
} from '@vaep/types';

/** PATCH /employees/:id body. Mirrors the shared @vaep/types contract. */
export class UpdateEmployeeDto implements IUpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_STATUSES)
  status?: EmployeeStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  persona?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;
}
