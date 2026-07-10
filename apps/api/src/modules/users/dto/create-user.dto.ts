import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import {
  ROLES,
  type CreateUserDto as ICreateUserDto,
  type Role,
} from '@vaep/types';

/** POST /users body. Mirrors the shared @vaep/types contract. */
export class CreateUserDto implements ICreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(ROLES)
  role!: Role;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
