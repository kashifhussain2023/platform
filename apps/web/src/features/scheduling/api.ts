import { apiClient } from '@/lib/apiClient';
import type {
  AddSlotDto,
  BlockDateDto,
  GenerateSlotsDto,
  InterviewSlotDto,
  RescheduleResultDto,
  RescheduleSlotDto,
  SlotStatus,
  SlotSummaryDto,
} from '@vaep/types';

export async function listSlots(status?: SlotStatus): Promise<InterviewSlotDto[]> {
  const { data } = await apiClient.get<InterviewSlotDto[]>('/scheduling/slots', {
    params: status ? { status } : undefined,
  });
  return data;
}

export async function getSummary(): Promise<SlotSummaryDto> {
  const { data } = await apiClient.get<SlotSummaryDto>('/scheduling/slots/summary');
  return data;
}

export async function generateSlots(
  dto: GenerateSlotsDto,
): Promise<{ created: number }> {
  const { data } = await apiClient.post<{ created: number }>(
    '/scheduling/slots/generate',
    dto,
  );
  return data;
}

export async function addSlot(dto: AddSlotDto): Promise<InterviewSlotDto> {
  const { data } = await apiClient.post<InterviewSlotDto>('/scheduling/slots', dto);
  return data;
}

export async function blockDate(dto: BlockDateDto): Promise<{ cancelled: number }> {
  const { data } = await apiClient.post<{ cancelled: number }>(
    '/scheduling/slots/block-date',
    dto,
  );
  return data;
}

export async function cancelSlot(id: string): Promise<InterviewSlotDto> {
  const { data } = await apiClient.post<InterviewSlotDto>(
    `/scheduling/slots/${id}/cancel`,
    {},
  );
  return data;
}

export async function rescheduleSlot(vars: {
  id: string;
  data?: RescheduleSlotDto;
}): Promise<RescheduleResultDto> {
  const { data } = await apiClient.post<RescheduleResultDto>(
    `/scheduling/slots/${vars.id}/reschedule`,
    vars.data ?? {},
  );
  return data;
}
