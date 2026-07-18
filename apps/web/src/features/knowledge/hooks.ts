'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EmployeeRole,
  KnowledgeDocumentDto,
  SearchQueryDto,
  SearchResultDto,
} from '@vaep/types';
import type { NormalizedApiError } from '@/lib/apiClient';
import { useSessionStore } from '@/stores/session.store';
import {
  deleteDocument,
  getDocumentContent,
  listDocuments,
  searchKnowledge,
  updateDocumentCategory,
  uploadDocument,
} from './api';

export const knowledgeKeys = {
  documents: (category?: EmployeeRole) =>
    ['knowledge', 'documents', category ?? 'all'] as const,
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
export function useDocuments(category?: EmployeeRole) {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<KnowledgeDocumentDto[], NormalizedApiError>({
    queryKey: knowledgeKeys.documents(category),
    queryFn: () => listDocuments(category),
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
    { file: File; category?: EmployeeRole },
    UploadContext
  >({
    mutationFn: ({ file, category }) => uploadDocument(file, category),
    onMutate: async ({ file, category }) => {
      await qc.cancelQueries({ queryKey: knowledgeKeys.documents() });
      const previous = qc.getQueryData<KnowledgeDocumentDto[]>(
        knowledgeKeys.documents(),
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
        category: category ?? null,
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData<KnowledgeDocumentDto[]>(knowledgeKeys.documents(), (old) => [
        optimistic,
        ...(old ?? []),
      ]);
      return { previous };
    },
    onError: (_err, _file, context) => {
      if (context?.previous) {
        qc.setQueryData(knowledgeKeys.documents(), context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: knowledgeKeys.documents() });
    },
  });
}

/** Delete mutation (optimistic): removes the row immediately, rolls back on error. */
export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation<void, NormalizedApiError, string, UploadContext>({
    mutationFn: deleteDocument,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: knowledgeKeys.documents() });
      const previous = qc.getQueryData<KnowledgeDocumentDto[]>(
        knowledgeKeys.documents(),
      );
      qc.setQueryData<KnowledgeDocumentDto[]>(knowledgeKeys.documents(), (old) =>
        (old ?? []).filter((d) => d.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(knowledgeKeys.documents(), context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: knowledgeKeys.documents() });
    },
  });
}

/**
 * View mutation — opens a document's raw bytes in a new browser tab (native
 * PDF viewer / text render), so a plain <a href> can't be used (the API route
 * is JWT-guarded, not cookie-auth). We open a blank tab SYNCHRONOUSLY inside
 * the click handler (before the async fetch) so popup blockers don't block it,
 * then navigate that tab to a blob: URL once the authenticated fetch resolves.
 */
export function useViewDocument() {
  return useMutation<void, NormalizedApiError, string>({
    mutationFn: async (id) => {
      const tab = window.open('', '_blank');
      try {
        const blob = await getDocumentContent(id);
        const url = URL.createObjectURL(blob);
        if (tab) {
          tab.location.href = url;
        } else {
          window.location.href = url;
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (err) {
        tab?.close();
        throw err;
      }
    },
  });
}

/** Search mutation — returns ranked chunk hits for the entered query. */
export function useSearchKnowledge() {
  return useMutation<SearchResultDto[], NormalizedApiError, SearchQueryDto>({
    mutationFn: searchKnowledge,
  });
}

/** Retag mutation — invalidates the documents cache on success so every open view (global + per-employee) refetches. */
export function useUpdateDocumentCategory() {
  const qc = useQueryClient();
  return useMutation<
    KnowledgeDocumentDto,
    NormalizedApiError,
    { id: string; category: EmployeeRole | null }
  >({
    mutationFn: ({ id, category }) => updateDocumentCategory(id, category),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['knowledge', 'documents'] });
    },
  });
}
