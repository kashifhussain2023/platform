// Re-export the shared validation contract so components import from the feature.
import { z } from 'zod';
import { employeeConfigSchema } from '@vaep/types';

export {
  createEmployeeSchema,
  updateEmployeeSchema,
  employeeConfigSchema,
  sendMessageSchema,
  EMPLOYEE_ROLES,
  EMPLOYEE_STATUSES,
  KNOWLEDGE_ACCESSES,
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
  MessageRole,
  SearchResultDto,
} from '@vaep/types';

/** The employee Settings panel form: name + the shared rich-config fields. */
export const employeeSettingsSchema = employeeConfigSchema.extend({
  name: z.string().min(1, 'Name is required').max(120),
});

export type EmployeeSettingsDto = z.infer<typeof employeeSettingsSchema>;
