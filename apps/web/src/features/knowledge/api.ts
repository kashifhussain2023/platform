import { apiClient } from '@/lib/apiClient';
import type {
  EmployeeRole,
  KnowledgeDocumentDto,
  SearchQueryDto,
  SearchResultDto,
} from '@vaep/types';

export async function listDocuments(
  category?: EmployeeRole,
): Promise<KnowledgeDocumentDto[]> {
  const { data } = await apiClient.get<KnowledgeDocumentDto[]>(
    '/knowledge/documents',
    { params: category ? { category } : undefined },
  );
  return data;
}

export async function uploadDocument(
  file: File,
  category?: EmployeeRole,
): Promise<KnowledgeDocumentDto> {
  const form = new FormData();
  form.append('file', file);
  if (category) {
    form.append('category', category);
  }
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

export async function updateDocumentCategory(
  id: string,
  category: EmployeeRole | null,
): Promise<KnowledgeDocumentDto> {
  const { data } = await apiClient.patch<KnowledgeDocumentDto>(
    `/knowledge/documents/${id}/category`,
    { category },
  );
  return data;
}

export async function getDocumentContent(id: string): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(
    `/knowledge/documents/${id}/content`,
    { responseType: 'blob' },
  );
  return data;
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
