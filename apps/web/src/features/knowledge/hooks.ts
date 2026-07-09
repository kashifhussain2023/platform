'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  KnowledgeDocumentDto,
  SearchQueryDto,
  SearchResultDto,
} from '@vaep/types';
import type { NormalizedApiError } from '@/lib/apiClient';
import { useSessionStore } from '@/stores/session.store';
import {
  deleteDocument,
  listDocuments,
  searchKnowledge,
  uploadDocument,
} from './api';

export const knowledgeKeys = {
  documents: ['knowledge', 'documents'] as const,
};

/** True while any document is still being ingested. */
function hasActiveIngestion(docs: KnowledgeDocumentDto[] | undefined): boolean {
  return Boolean(
    docs?.some((d) => d.status === 'PENDING' || d.status === 'PROCESSING'),
  );
}

/**
 * Documents query. Polls every 2s WHILE any doc is PENDING/PROCESSING so status
 * badges advance to READY/FAILED live, then stops (refetchInterval → false).
 */
export function useDocuments() {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<KnowledgeDocumentDto[], NormalizedApiError>({
    queryKey: knowledgeKeys.documents,
    queryFn: listDocuments,
    enabled: Boolean(accessToken),
    refetchInterval: (query) =>
      hasActiveIngestion(query.state.data) ? 2000 : false,
  });
}

interface UploadContext {
  previous?: KnowledgeDocumentDto[];
}

/**
 * Upload mutation (optimistic): onMutate prepends a temp PENDING doc to the list
 * cache, onError rolls back, onSettled invalidates so the server row (with its
 * real id + status) replaces the placeholder.
 */
export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation<
    KnowledgeDocumentDto,
    NormalizedApiError,
    File,
    UploadContext
  >({
    mutationFn: uploadDocument,
    onMutate: async (file) => {
      await qc.cancelQueries({ queryKey: knowledgeKeys.documents });
      const previous = qc.getQueryData<KnowledgeDocumentDto[]>(
        knowledgeKeys.documents,
      );
      const optimistic: KnowledgeDocumentDto = {
        id: `temp_${Date.now()}`,
        companyId: '',
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        status: 'PENDING',
        error: null,
        chunkCount: 0,
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData<KnowledgeDocumentDto[]>(knowledgeKeys.documents, (old) => [
        optimistic,
        ...(old ?? []),
      ]);
      return { previous };
    },
    onError: (_err, _file, context) => {
      if (context?.previous) {
        qc.setQueryData(knowledgeKeys.documents, context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: knowledgeKeys.documents });
    },
  });
}

/** Delete mutation (optimistic): removes the row immediately, rolls back on error. */
export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation<void, NormalizedApiError, string, UploadContext>({
    mutationFn: deleteDocument,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: knowledgeKeys.documents });
      const previous = qc.getQueryData<KnowledgeDocumentDto[]>(
        knowledgeKeys.documents,
      );
      qc.setQueryData<KnowledgeDocumentDto[]>(knowledgeKeys.documents, (old) =>
        (old ?? []).filter((d) => d.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(knowledgeKeys.documents, context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: knowledgeKeys.documents });
    },
  });
}

/** Search mutation — returns ranked chunk hits for the entered query. */
export function useSearchKnowledge() {
  return useMutation<SearchResultDto[], NormalizedApiError, SearchQueryDto>({
    mutationFn: searchKnowledge,
  });
}
