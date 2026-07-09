import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  NODE_TYPES,
  type NodeType,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from '@vaep/types';

/** One node in a workflow graph. `config` is validated loosely (shape per type). */
export class WorkflowNodeDto implements WorkflowNode {
  @IsString()
  @MinLength(1)
  id!: string;

  @IsIn(NODE_TYPES)
  type!: NodeType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsObject()
  config!: Record<string, unknown>;
}

/** A directed edge; `branch` selects a CONDITION outcome. */
export class WorkflowEdgeDto implements WorkflowEdge {
  @IsString()
  @MinLength(1)
  from!: string;

  @IsString()
  @MinLength(1)
  to!: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  branch?: 'true' | 'false';
}

/** The full graph ({nodes, edges}) persisted on a workflow. */
export class WorkflowDefinitionDto implements WorkflowDefinition {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowNodeDto)
  nodes!: WorkflowNodeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowEdgeDto)
  edges!: WorkflowEdgeDto[];
}
