import { IsBoolean, IsObject, IsOptional } from 'class-validator';
import type { RunWorkflowDto as IRunWorkflowDto } from '@vaep/types';

/** POST /workflows/:id/run body. Optional free-form trigger payload. */
export class RunWorkflowDto implements IRunWorkflowDto {
  @IsOptional()
  @IsObject()
  trigger?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
