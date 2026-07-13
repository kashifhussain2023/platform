// Re-export the shared validation contract so components import from the feature.
export {
  generateSlotsSchema,
  addSlotSchema,
  blockDateSchema,
  rescheduleSlotSchema,
} from '@vaep/types';
export type {
  GenerateSlotsDto,
  AddSlotDto,
  BlockDateDto,
  RescheduleSlotDto,
  InterviewSlotDto,
  SlotSummaryDto,
  SlotStatus,
  ClaimAndScheduleResultDto,
  RescheduleResultDto,
} from '@vaep/types';
