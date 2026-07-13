import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { RescheduleSlotDto as IRescheduleSlotDto } from '@vaep/types';

/** POST /scheduling/slots/:id/reschedule body. Mirrors @vaep/types. */
export class RescheduleSlotDto implements IRescheduleSlotDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
