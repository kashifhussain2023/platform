import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  EMPLOYEE_ROLES,
  type CompleteOnboardingDto as ICompleteOnboardingDto,
  type EmployeeRole,
} from '@vaep/types';

class OnboardingBusinessDto {
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
  @MaxLength(2000)
  description?: string;
}

class OnboardingEmployeeDto {
  @IsIn(EMPLOYEE_ROLES)
  role!: EmployeeRole;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

/** POST /onboarding/complete body. Mirrors the shared @vaep/types contract. */
export class CompleteOnboardingDto implements ICompleteOnboardingDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardingBusinessDto)
  business?: OnboardingBusinessDto;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  departments!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingEmployeeDto)
  employees!: OnboardingEmployeeDto[];
}
