import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { FireEventDto as IFireEventDto } from '@vaep/types';

/** POST /workflows/events body — fire an internal event to EVENT workflows. */
export class FireEventDto implements IFireEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  eventType!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MinLength(1)
  connectorId?: string;
}
