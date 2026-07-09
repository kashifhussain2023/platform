import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, validateSync } from 'class-validator';

/**
 * Environment contract for the API. Validated once at boot via ConfigModule.
 */
export class EnvVars {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsOptional()
  ACCESS_TTL?: string;

  @IsString()
  @IsOptional()
  REFRESH_TTL?: string;

  @IsString()
  @IsOptional()
  PORT?: string;

  @IsString()
  @IsOptional()
  WEB_ORIGIN?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
    forbidUnknownValues: false,
  });
  if (errors.length > 0) {
    const details = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Invalid environment variables: ${details}`);
  }
  return validated;
}
