import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  WORKFLOW_STATUSES,
  type UpdateWorkflowDto as IUpdateWorkflowDto,
  type WorkflowStatus,
} from '@vaep/types';
import { WorkflowDefinitionDto } from './workflow-definition.dto';

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
}
