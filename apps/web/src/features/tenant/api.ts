import { apiClient } from '@/lib/apiClient';
import type { CompanyDto, UpdateCompanyDto } from '@vaep/types';

export async function currentCompanyRequest(): Promise<CompanyDto> {
  const { data } = await apiClient.get<CompanyDto>('/tenant/me');
  return data;
}

export async function updateCompanyRequest(
  payload: UpdateCompanyDto,
): Promise<CompanyDto> {
  const { data } = await apiClient.patch<CompanyDto>(
    '/companies/current',
    payload,
  );
  return data;
}
