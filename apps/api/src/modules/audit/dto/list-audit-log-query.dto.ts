import { IsOptional, IsString } from 'class-validator';

/** GET /audit-log?entityType=...&limit=... query params. */
export class ListAuditLogQueryDto {
  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
