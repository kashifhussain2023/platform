import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
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

  // Security policy (P1 #7): registration has no company/policy yet, so the
  // default passwordMinLength of 8 is enforced here as a hard minimum.
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  // Optional company profile (Step 2 richer registration) + admin phone.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}
