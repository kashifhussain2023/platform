import { apiClient } from '@/lib/apiClient';
import type {
  CreateDepartmentDto,
  CreateTeamDto,
  DepartmentDto,
  SecurityPolicyDto,
  TeamDto,
  UpdateDepartmentDto,
  UpdateSecurityPolicyDto,
  UpdateTeamDto,
} from '@vaep/types';

// --- Departments -----------------------------------------------------------

export async function listDepartments(): Promise<DepartmentDto[]> {
  const { data } = await apiClient.get<DepartmentDto[]>('/departments');
  return data;
}

export async function createDepartment(
  payload: CreateDepartmentDto,
): Promise<DepartmentDto> {
  const { data } = await apiClient.post<DepartmentDto>('/departments', payload);
  return data;
}

export async function updateDepartment(vars: {
  id: string;
  data: UpdateDepartmentDto;
}): Promise<DepartmentDto> {
  const { data } = await apiClient.patch<DepartmentDto>(
    `/departments/${vars.id}`,
    vars.data,
  );
  return data;
}

export async function deleteDepartment(id: string): Promise<void> {
  await apiClient.delete(`/departments/${id}`);
}

// --- Teams -----------------------------------------------------------------

export async function listTeams(): Promise<TeamDto[]> {
  const { data } = await apiClient.get<TeamDto[]>('/teams');
  return data;
}

export async function createTeam(payload: CreateTeamDto): Promise<TeamDto> {
  const { data } = await apiClient.post<TeamDto>('/teams', payload);
  return data;
}

export async function updateTeam(vars: {
  id: string;
  data: UpdateTeamDto;
}): Promise<TeamDto> {
  const { data } = await apiClient.patch<TeamDto>(`/teams/${vars.id}`, vars.data);
  return data;
}

export async function deleteTeam(id: string): Promise<void> {
  await apiClient.delete(`/teams/${id}`);
}

// --- Security policy -------------------------------------------------------

export async function getSecurityPolicy(): Promise<SecurityPolicyDto> {
  const { data } = await apiClient.get<SecurityPolicyDto>('/security-policy');
  return data;
}

export async function updateSecurityPolicy(
  payload: UpdateSecurityPolicyDto,
): Promise<SecurityPolicyDto> {
  const { data } = await apiClient.patch<SecurityPolicyDto>(
    '/security-policy',
    payload,
  );
  return data;
}
