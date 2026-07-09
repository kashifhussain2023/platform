import { apiClient } from '@/lib/apiClient';
import type {
  EmployeeSkillDto,
  InstallSkillDto,
  InstalledSkillDto,
  SkillDefinitionDto,
  UpdateInstalledSkillDto,
} from '@vaep/types';

// --- Catalog + installed skills --------------------------------------------

export async function listCatalog(): Promise<SkillDefinitionDto[]> {
  const { data } = await apiClient.get<SkillDefinitionDto[]>('/skills/catalog');
  return data;
}

export async function listInstalledSkills(): Promise<InstalledSkillDto[]> {
  const { data } =
    await apiClient.get<InstalledSkillDto[]>('/skills/installed');
  return data;
}

export async function installSkill(
  payload: InstallSkillDto,
): Promise<InstalledSkillDto> {
  const { data } = await apiClient.post<InstalledSkillDto>(
    '/skills/install',
    payload,
  );
  return data;
}

export async function updateInstalledSkill(vars: {
  id: string;
  data: UpdateInstalledSkillDto;
}): Promise<InstalledSkillDto> {
  const { data } = await apiClient.patch<InstalledSkillDto>(
    `/skills/installed/${vars.id}`,
    vars.data,
  );
  return data;
}

export async function uninstallSkill(id: string): Promise<void> {
  await apiClient.delete(`/skills/installed/${id}`);
}

// --- Employee ↔ skill assignments ------------------------------------------

export async function listEmployeeSkills(
  employeeId: string,
): Promise<EmployeeSkillDto[]> {
  const { data } = await apiClient.get<EmployeeSkillDto[]>(
    `/employees/${employeeId}/skills`,
  );
  return data;
}

export async function assignSkill(vars: {
  employeeId: string;
  installedSkillId: string;
}): Promise<EmployeeSkillDto> {
  const { data } = await apiClient.post<EmployeeSkillDto>(
    `/employees/${vars.employeeId}/skills`,
    { installedSkillId: vars.installedSkillId },
  );
  return data;
}

export async function unassignSkill(vars: {
  employeeId: string;
  installedSkillId: string;
}): Promise<void> {
  await apiClient.delete(
    `/employees/${vars.employeeId}/skills/${vars.installedSkillId}`,
  );
}
