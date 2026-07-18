import { Injectable } from '@nestjs/common';
import type { EmployeeRole, KnowledgeAccess, SearchResultDto } from '@vaep/types';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { RETRIEVAL_K } from '../employees.constants';

/**
 * The "retrieve-knowledge" step of the agent loop. Delegates to the Knowledge
 * module's tenant-scoped pgvector search (KnowledgeService.retrieve) so the
 * embedding + cosine-similarity SQL is reused, not duplicated. Failures are
 * swallowed to an empty result so a retrieval hiccup never aborts a run.
 *
 * An employee whose `knowledgeAccess` is `NONE` skips retrieval entirely
 * (returns []); the default `ALL` preserves the original behaviour.
 *
 * `category` (the calling employee's role) scopes the search to that role's
 * documents plus Shared ones (docs/specs/2026-07-14-knowledge-role-scoping-
 * design.md) — omitting it preserves the original unfiltered behaviour.
 */
@Injectable()
export class RetrievalService {
  constructor(private readonly knowledge: KnowledgeService) {}

  async retrieve(
    companyId: string,
    query: string,
    knowledgeAccess: KnowledgeAccess = 'ALL',
    k: number = RETRIEVAL_K,
    category?: EmployeeRole,
  ): Promise<SearchResultDto[]> {
    if (knowledgeAccess === 'NONE') {
      return [];
    }
    const text = query.trim();
    if (!text) {
      return [];
    }
    return this.knowledge.retrieve(companyId, text, k, category);
  }
}
