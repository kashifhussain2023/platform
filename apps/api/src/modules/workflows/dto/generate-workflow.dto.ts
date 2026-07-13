import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type {
  GenerateWorkflowDto as IGenerateWorkflowDto,
  GenerateWorkflowMessageDto as IGenerateWorkflowMessageDto,
} from '@vaep/types';

export class GenerateWorkflowMessageDto implements IGenerateWorkflowMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}

/** POST /workflows/generate body — the whole chat so far. */
export class GenerateWorkflowDto implements IGenerateWorkflowDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GenerateWorkflowMessageDto)
  messages!: GenerateWorkflowMessageDto[];
}
