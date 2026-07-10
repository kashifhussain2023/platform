import { apiClient } from '@/lib/apiClient';
import type { CreateUserDto, UpdateUserDto, UserDto } from '@vaep/types';

/** All users in the caller's company. */
export async function listUsers(): Promise<UserDto[]> {
  const { data } = await apiClient.get<UserDto[]>('/users');
  return data;
}

/** Add a user to the company (OWNER/ADMIN only server-side). */
export async function createUser(payload: CreateUserDto): Promise<UserDto> {
  const { data } = await apiClient.post<UserDto>('/users', payload);
  return data;
}

/** Update a user's name/role/status (OWNER/ADMIN only server-side). */
export async function updateUser(vars: {
  id: string;
  data: UpdateUserDto;
}): Promise<UserDto> {
  const { data } = await apiClient.patch<UserDto>(`/users/${vars.id}`, vars.data);
  return data;
}

/** Delete a user (OWNER/ADMIN only server-side). */
export async function deleteUser(id: string): Promise<void> {
  await apiClient.delete(`/users/${id}`);
}
