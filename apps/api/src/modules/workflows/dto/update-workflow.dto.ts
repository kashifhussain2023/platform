import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  TRIGGER_TYPES,
  WORKFLOW_STATUSES,
  type TriggerConfig,
  type TriggerType,
  type UpdateWorkflowDto as IUpdateWorkflowDto,
  type WorkflowStatus,
} from '@vaep/types';
import { WorkflowDefinitionDto } from './workflow-definition.dto';

/** SCHEDULE/EVENT trigger config (shape-per-type is validated in the service). */
export class TriggerConfigDto implements TriggerConfig {
  @IsOptional()
  @IsInt()
  @Min(15000)
  everyMs?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cron?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  eventType?: string;
}

/** PATCH /workflows/:id body. Mirrors the shared @vaep/types contract. */
export class UpdateWorkflowDto implements IUpdateWorkflowDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowDefinitionDto)
  definition?: WorkflowDefinitionDto;

  @IsOptional()
  @IsIn(WORKFLOW_STATUSES)
  status?: WorkflowStatus;

  @IsOptional()
  @IsIn(TRIGGER_TYPES)
  triggerType?: TriggerType;

  @IsOptional()
  @ValidateNested()
  @Type(() => TriggerConfigDto)
  triggerConfig?: TriggerConfigDto;
}
