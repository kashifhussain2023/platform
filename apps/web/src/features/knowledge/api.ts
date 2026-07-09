import { apiClient } from '@/lib/apiClient';
import type {
  KnowledgeDocumentDto,
  SearchQueryDto,
  SearchResultDto,
} from '@vaep/types';

export async function listDocuments(): Promise<KnowledgeDocumentDto[]> {
  const { data } = await apiClient.get<KnowledgeDocumentDto[]>(
    '/knowledge/documents',
  );
  return data;
}

export async function uploadDocument(
  file: File,
): Promise<KnowledgeDocumentDto> {
  const form = new FormData();
  form.append('file', file);
  // Override the client's default application/json: with a multipart body the
  // browser sets Content-Type (incl. the boundary) itself. Leaving json here
  // would make axios serialize the FormData to JSON and drop the file.
  const { data } = await apiClient.post<KnowledgeDocumentDto>(
    '/knowledge/documents',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function deleteDocument(id: string): Promise<void> {
  await apiClient.delete(`/knowledge/documents/${id}`);
}

export async function searchKnowledge(
  payload: SearchQueryDto,
): Promise<SearchResultDto[]> {
  const { data } = await apiClient.post<SearchResultDto[]>(
    '/knowledge/search',
    payload,
  );
  return data;
}
