import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  FEEDBACK_RATINGS,
  type CreateFeedbackDto as ICreateFeedbackDto,
  type FeedbackRating,
} from '@vaep/types';

/** POST /employees/:id/feedback body. Mirrors the shared @vaep/types contract. */
export class CreateFeedbackDto implements ICreateFeedbackDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  conversationId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  messageId?: string;

  @IsIn(FEEDBACK_RATINGS)
  rating!: FeedbackRating;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  correction?: string;

  @IsOptional()
  @IsBoolean()
  teach?: boolean;
}
