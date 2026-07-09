import { IsEmail, IsString, MinLength } from 'class-validator';
import type { LoginDto as ILoginDto } from '@vaep/types';

/** POST /auth/login body. Mirrors the shared @vaep/types contract. */
export class LoginDto implements ILoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
