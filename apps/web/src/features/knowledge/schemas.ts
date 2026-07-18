// Re-export the shared validation contract so components import from the feature.
export { EMPLOYEE_ROLES, searchSchema } from '@vaep/types';
export type {
  DocumentStatus,
  EmployeeRole,
  KnowledgeDocumentDto,
  SearchQueryDto,
  SearchResultDto,
  UpdateDocumentCategoryDto,
} from '@vaep/types';
