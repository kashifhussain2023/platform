// Re-export the shared validation contract so components import from the feature.
export { searchSchema } from '@vaep/types';
export type {
  DocumentStatus,
  KnowledgeDocumentDto,
  SearchQueryDto,
  SearchResultDto,
} from '@vaep/types';
