import { Injectable } from '@nestjs/common';
import type { SearchResultDto } from '@vaep/types';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { RETRIEVAL_K } from '../employees.constants';

/**
 * The "retrieve-knowledge" step of the agent loop. Delegates to the Knowledge
 * module's tenant-scoped pgvector search (KnowledgeService.retrieve) so the
 * embedding + cosine-similarity SQL is reused, not duplicated. Failures are
 * swallowed to an empty result so a retrieval hiccup never aborts a run.
 */
@Injectable()
export class RetrievalService {
  constructor(private readonly knowledge: KnowledgeService) {}

  async retrieve(
    companyId: string,
    query: string,
    k: number = RETRIEVAL_K,
  ): Promise<SearchResultDto[]> {
    const text = query.trim();
    if (!text) {
      return [];
    }
    return this.knowledge.retrieve(companyId, text, k);
  }
}
