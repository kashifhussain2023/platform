import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { CreateWorkflowDto as ICreateWorkflowDto } from '@vaep/types';
import { WorkflowDefinitionDto } from './workflow-definition.dto';

/** POST /workflows body. Mirrors the shared @vaep/types contract. */
export class CreateWorkflowDto implements ICreateWorkflowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowDefinitionDto)
  definition?: WorkflowDefinitionDto;
}
