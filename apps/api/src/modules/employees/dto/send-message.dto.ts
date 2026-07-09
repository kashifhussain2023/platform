import { IsString, MaxLength, MinLength } from 'class-validator';
import type { SendMessageDto as ISendMessageDto } from '@vaep/types';

/** POST /conversations/:id/messages body. Mirrors the shared @vaep/types contract. */
export class SendMessageDto implements ISendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}
