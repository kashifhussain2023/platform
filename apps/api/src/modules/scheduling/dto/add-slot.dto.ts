import { IsString } from 'class-validator';
import type { AddSlotDto as IAddSlotDto } from '@vaep/types';

/** POST /scheduling/slots body. Mirrors @vaep/types. */
export class AddSlotDto implements IAddSlotDto {
  @IsString()
  start!: string;

  @IsString()
  end!: string;
}
