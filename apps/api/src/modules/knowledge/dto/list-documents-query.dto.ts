import { IsIn, IsOptional, IsString } from 'class-validator';
import { EMPLOYEE_ROLES, type EmployeeRole } from '@vaep/types';

/** GET /knowledge/documents?category=...&limit=... query params. */
export class ListDocumentsQueryDto {
  @IsOptional()
  @IsIn(EMPLOYEE_ROLES)
  category?: EmployeeRole;

  @IsOptional()
  @IsString()
  limit?: string;
}
