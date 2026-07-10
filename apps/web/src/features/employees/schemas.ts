// Re-export the shared validation contract so components import from the feature.
import { z } from 'zod';
import { employeeConfigSchema } from '@vaep/types';

export {
  createEmployeeSchema,
  updateEmployeeSchema,
  employeeConfigSchema,
  kpiTargetsSchema,
  sendMessageSchema,
  createFeedbackSchema,
  createMemorySchema,
  EMPLOYEE_ROLES,
  EMPLOYEE_STATUSES,
  KNOWLEDGE_ACCESSES,
  FEEDBACK_RATINGS,
  MEMORY_KINDS,
} from '@vaep/types';
export type {
  AiEmployeeDto,
  ConversationDto,
  CreateEmployeeDto,
  UpdateEmployeeDto,
  EmployeeConfigDto,
  SendMessageDto,
  MessageDto,
  MessageMetadataDto,
  MessageValidationDto,
  RunResultDto,
  EmployeeRole,
  EmployeeStatus,
  KnowledgeAccess,
  KpiTargets,
  MessageRole,
  SearchResultDto,
  CreateFeedbackDto,
  CreateMemoryDto,
  EmployeeFeedbackDto,
  EmployeeMemoryDto,
  LearningSummaryDto,
  FeedbackRating,
  MemoryKind,
  MemorySource,
} from '@vaep/types';

/** The employee Settings panel form: name + the shared rich-config fields. */
export const employeeSettingsSchema = employeeConfigSchema.extend({
  name: z.string().min(1, 'Name is required').max(120),
});

export type EmployeeSettingsDto = z.infer<typeof employeeSettingsSchema>;
