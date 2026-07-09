import { apiClient } from '@/lib/apiClient';
import type {
  AiEmployeeDto,
  ConversationDto,
  CreateEmployeeDto,
  MessageDto,
  RunResultDto,
  UpdateEmployeeDto,
} from '@vaep/types';

export async function listEmployees(): Promise<AiEmployeeDto[]> {
  const { data } = await apiClient.get<AiEmployeeDto[]>('/employees');
  return data;
}

export async function getEmployee(id: string): Promise<AiEmployeeDto> {
  const { data } = await apiClient.get<AiEmployeeDto>(`/employees/${id}`);
  return data;
}

export async function createEmployee(
  payload: CreateEmployeeDto,
): Promise<AiEmployeeDto> {
  const { data } = await apiClient.post<AiEmployeeDto>('/employees', payload);
  return data;
}

export async function updateEmployee(vars: {
  id: string;
  data: UpdateEmployeeDto;
}): Promise<AiEmployeeDto> {
  const { data } = await apiClient.patch<AiEmployeeDto>(
    `/employees/${vars.id}`,
    vars.data,
  );
  return data;
}

export async function deleteEmployee(id: string): Promise<void> {
  await apiClient.delete(`/employees/${id}`);
}

export async function listConversations(
  employeeId: string,
): Promise<ConversationDto[]> {
  const { data } = await apiClient.get<ConversationDto[]>(
    `/employees/${employeeId}/conversations`,
  );
  return data;
}

export async function startConversation(vars: {
  employeeId: string;
  title?: string;
}): Promise<ConversationDto> {
  const { data } = await apiClient.post<ConversationDto>(
    `/employees/${vars.employeeId}/conversations`,
    { title: vars.title },
  );
  return data;
}

export async function listMessages(
  conversationId: string,
): Promise<MessageDto[]> {
  const { data } = await apiClient.get<MessageDto[]>(
    `/conversations/${conversationId}/messages`,
  );
  return data;
}

export async function sendMessage(vars: {
  conversationId: string;
  content: string;
}): Promise<RunResultDto> {
  const { data } = await apiClient.post<RunResultDto>(
    `/conversations/${vars.conversationId}/messages`,
    { content: vars.content },
  );
  return data;
}
