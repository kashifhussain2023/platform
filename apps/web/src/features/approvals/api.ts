import { apiClient } from '@/lib/apiClient';
import type {
  ApprovalRequestDto,
  ApprovalStatus,
  DecideApprovalDto,
  ModifyApprovalDto,
} from '@vaep/types';

/** List approval requests, optionally filtered by status. */
export async function listApprovals(
  status?: ApprovalStatus,
): Promise<ApprovalRequestDto[]> {
  const { data } = await apiClient.get<ApprovalRequestDto[]>('/approvals', {
    params: status ? { status } : undefined,
  });
  return data;
}

export async function approveRequest(vars: {
  id: string;
  data?: DecideApprovalDto;
}): Promise<ApprovalRequestDto> {
  const { data } = await apiClient.post<ApprovalRequestDto>(
    `/approvals/${vars.id}/approve`,
    vars.data ?? {},
  );
  return data;
}

export async function rejectRequest(vars: {
  id: string;
  data?: DecideApprovalDto;
}): Promise<ApprovalRequestDto> {
  const { data } = await apiClient.post<ApprovalRequestDto>(
    `/approvals/${vars.id}/reject`,
    vars.data ?? {},
  );
  return data;
}

export async function modifyRequest(vars: {
  id: string;
  data: ModifyApprovalDto;
}): Promise<ApprovalRequestDto> {
  const { data } = await apiClient.post<ApprovalRequestDto>(
    `/approvals/${vars.id}/modify`,
    vars.data,
  );
  return data;
}
