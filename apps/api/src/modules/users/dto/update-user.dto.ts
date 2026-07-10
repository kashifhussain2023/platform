import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ROLES,
  USER_STATUSES,
  type Role,
  type UpdateUserDto as IUpdateUserDto,
  type UserStatus,
} from '@vaep/types';

/** PATCH /users/:id body. Mirrors the shared @vaep/types contract. */
export class UpdateUserDto implements IUpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: UserStatus;
}
