import { IsIn, IsOptional } from 'class-validator';
import { EMPLOYEE_ROLES, type EmployeeRole } from '@vaep/types';

/** GET /knowledge/documents?category=... query params. */
export class ListDocumentsQueryDto {
  @IsOptional()
  @IsIn(EMPLOYEE_ROLES)
  category?: EmployeeRole;
}
