import { apiClient } from '@/lib/apiClient';
import type { CompanyDto } from '@vaep/types';

export async function currentCompanyRequest(): Promise<CompanyDto> {
  const { data } = await apiClient.get<CompanyDto>('/tenant/me');
  return data;
}
