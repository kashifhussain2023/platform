// Re-export the shared validation contract so components import from the feature.
export {
  createEmployeeSchema,
  updateEmployeeSchema,
  sendMessageSchema,
  EMPLOYEE_ROLES,
  EMPLOYEE_STATUSES,
} from '@vaep/types';
export type {
  AiEmployeeDto,
  ConversationDto,
  CreateEmployeeDto,
  UpdateEmployeeDto,
  SendMessageDto,
  MessageDto,
  MessageMetadataDto,
  MessageValidationDto,
  RunResultDto,
  EmployeeRole,
  EmployeeStatus,
  MessageRole,
  SearchResultDto,
} from '@vaep/types';
