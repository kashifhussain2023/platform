import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import {
  MEMORY_KINDS,
  type CreateMemoryDto as ICreateMemoryDto,
  type MemoryKind,
} from '@vaep/types';

/** POST /employees/:id/memories body. Mirrors the shared @vaep/types contract. */
export class CreateMemoryDto implements ICreateMemoryDto {
  @IsIn(MEMORY_KINDS)
  kind!: MemoryKind;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}
