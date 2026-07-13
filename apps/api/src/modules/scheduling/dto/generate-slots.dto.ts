import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, Max, Min } from 'class-validator';
import type { GenerateSlotsDto as IGenerateSlotsDto } from '@vaep/types';

/** POST /scheduling/slots/generate body. Mirrors @vaep/types. */
export class GenerateSlotsDto implements IGenerateSlotsDto {
  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek!: number[];

  @IsInt()
  @Min(0)
  @Max(23)
  dailyStartHour!: number;

  @IsInt()
  @Min(0)
  @Max(23)
  dailyEndHour!: number;

  @IsInt()
  @Min(5)
  @Max(480)
  slotMinutes!: number;
}
