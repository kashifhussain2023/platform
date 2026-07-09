import { apiClient } from '@/lib/apiClient';
import type {
  AuthResponse,
  LoginDto,
  MeDto,
  RegisterDto,
} from '@vaep/types';

export async function registerRequest(
  payload: RegisterDto,
): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>('/auth/register', payload);
  return data;
}

export async function loginRequest(payload: LoginDto): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>('/auth/login', payload);
  return data;
}

export async function meRequest(): Promise<MeDto> {
  const { data } = await apiClient.get<MeDto>('/auth/me');
  return data;
}

export async function logoutRequest(): Promise<void> {
  // This slice has no server-side session revocation endpoint yet; clearing the
  // client store (in the hook) is sufficient. Placeholder for POST /auth/logout.
  return Promise.resolve();
}
