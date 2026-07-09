import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { SearchQueryDto } from '@vaep/types';

/** POST /knowledge/search body. Mirrors the shared @vaep/types contract. */
export class SearchDto implements SearchQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  k?: number;
}
