import { IsString } from 'class-validator';
import type { BlockDateDto as IBlockDateDto } from '@vaep/types';

/** POST /scheduling/slots/block-date body. Mirrors @vaep/types. */
export class BlockDateDto implements IBlockDateDto {
  @IsString()
  date!: string;
}
