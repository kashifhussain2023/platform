import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { DecideApprovalDto as IDecideApprovalDto } from '@vaep/types';

/** POST /approvals/:id/approve|reject body. Mirrors @vaep/types. */
export class DecideApprovalDto implements IDecideApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
