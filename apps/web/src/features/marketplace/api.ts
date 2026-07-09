import { apiClient } from '@/lib/apiClient';
import type {
  AiEmployeeDto,
  InstallEmployeeDto,
  MarketplaceCatalogDto,
  WorkflowDto,
} from '@vaep/types';

/** The unified marketplace catalog (employees + workflows + reused skills). */
export async function getMarketplace(): Promise<MarketplaceCatalogDto> {
  const { data } = await apiClient.get<MarketplaceCatalogDto>('/marketplace');
  return data;
}

/** Hire an AI employee from a template (optional name override). */
export async function installEmployeeTemplate(vars: {
  key: string;
  data: InstallEmployeeDto;
}): Promise<AiEmployeeDto> {
  const { data } = await apiClient.post<AiEmployeeDto>(
    `/marketplace/employees/${vars.key}/install`,
    vars.data,
  );
  return data;
}

/** Install a workflow template as a new workflow. */
export async function installWorkflowTemplate(key: string): Promise<WorkflowDto> {
  const { data } = await apiClient.post<WorkflowDto>(
    `/marketplace/workflows/${key}/install`,
    {},
  );
  return data;
}
