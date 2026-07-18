import { IsIn, IsOptional } from 'class-validator';
import { EMPLOYEE_ROLES, type EmployeeRole } from '@vaep/types';

/** POST /knowledge/documents multipart body (alongside the `file` field). */
export class UploadDocumentDto {
  @IsOptional()
  @IsIn(EMPLOYEE_ROLES)
  category?: EmployeeRole;
}
