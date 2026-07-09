import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { ModifyApprovalDto as IModifyApprovalDto } from '@vaep/types';

/** POST /approvals/:id/modify body (edited args + optional note). Mirrors @vaep/types. */
export class ModifyApprovalDto implements IModifyApprovalDto {
  @IsObject()
  args!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
