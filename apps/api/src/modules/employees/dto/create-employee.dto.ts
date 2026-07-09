import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  EMPLOYEE_ROLES,
  type CreateEmployeeDto as ICreateEmployeeDto,
  type EmployeeRole,
} from '@vaep/types';

/** POST /employees body. Mirrors the shared @vaep/types contract. */
export class CreateEmployeeDto implements ICreateEmployeeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(EMPLOYEE_ROLES)
  role!: EmployeeRole;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  persona?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;
}
