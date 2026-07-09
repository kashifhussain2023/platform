import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { RegisterDto as IRegisterDto } from '@vaep/types';

/** POST /auth/register body. Mirrors the shared @vaep/types contract. */
export class RegisterDto implements IRegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
