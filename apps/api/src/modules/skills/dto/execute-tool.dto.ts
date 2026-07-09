import { IsObject } from 'class-validator';
import type { ExecuteToolDto as IExecuteToolDto } from '@vaep/types';

/** POST /skills/installed/:id/tools/:tool/execute body. Mirrors @vaep/types. */
export class ExecuteToolDto implements IExecuteToolDto {
  @IsObject()
  args!: Record<string, unknown>;
}
