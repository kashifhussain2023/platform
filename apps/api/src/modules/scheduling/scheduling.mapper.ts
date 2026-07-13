import type { InterviewSlot } from '@prisma/client';
import type { InterviewSlotDto } from '@vaep/types';

/** Prisma row → public DTO mapper for the scheduling module. */
export function toInterviewSlotDto(s: InterviewSlot): InterviewSlotDto {
  return {
    id: s.id,
    companyId: s.companyId,
    start: s.start.toISOString(),
    end: s.end.toISOString(),
    status: s.status,
    bookedFor: s.bookedFor,
    workflowRunId: s.workflowRunId,
    calendarEventId: s.calendarEventId,
    meetLink: s.meetLink,
    cancelReason: s.cancelReason,
    createdAt: s.createdAt.toISOString(),
  };
}
