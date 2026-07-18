import { IsIn, ValidateIf } from 'class-validator';
import { EMPLOYEE_ROLES, type EmployeeRole } from '@vaep/types';

/** PATCH /knowledge/documents/:id/category body. `category: null` = Shared/company-wide. */
export class UpdateDocumentCategoryDto {
  @ValidateIf((_dto: UpdateDocumentCategoryDto, value: unknown) => value !== null)
  @IsIn(EMPLOYEE_ROLES)
  category!: EmployeeRole | null;
}
