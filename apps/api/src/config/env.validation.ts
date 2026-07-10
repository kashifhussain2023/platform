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

  // --- Knowledge / RAG module -------------------------------------------
  /** Redis connection for the BullMQ ingestion queue. Required. */
  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  /** 'hash' (default, zero-dep) | 'local' (@xenova) | 'openai'. */
  @IsString()
  @IsOptional()
  EMBEDDINGS_PROVIDER?: string;

  /** 'local' (default, filesystem) | 's3' (MinIO/S3-compatible). */
  @IsString()
  @IsOptional()
  STORAGE_PROVIDER?: string;

  /** Base dir for LocalStorageProvider (default apps/api/.storage). */
  @IsString()
  @IsOptional()
  STORAGE_DIR?: string;

  @IsString()
  @IsOptional()
  OPENAI_API_KEY?: string;

  @IsString()
  @IsOptional()
  S3_ENDPOINT?: string;

  @IsString()
  @IsOptional()
  S3_BUCKET?: string;

  @IsString()
  @IsOptional()
  S3_ACCESS_KEY?: string;

  @IsString()
  @IsOptional()
  S3_SECRET_KEY?: string;

  // --- AI Employee runtime ----------------------------------------------
  /** 'mock' (default, offline/deterministic) | 'anthropic' | 'openai'. */
  @IsString()
  @IsOptional()
  LLM_PROVIDER?: string;

  /** Override model id (anthropic default claude-sonnet-5 / openai default gpt-4o-mini). */
  @IsString()
  @IsOptional()
  LLM_MODEL?: string;

  /** Required only when LLM_PROVIDER=anthropic. */
  @IsString()
  @IsOptional()
  ANTHROPIC_API_KEY?: string;

  // --- Skills module ----------------------------------------------------
  /** 'mock' (default, offline/deterministic sandbox executor). */
  @IsString()
  @IsOptional()
  SKILL_EXECUTOR?: string;

  // --- Billing & Subscription module ------------------------------------
  /** 'mock' (default, offline/deterministic) | 'stripe' (lazy SDK). */
  @IsString()
  @IsOptional()
  BILLING_PROVIDER?: string;

  /** Required only when BILLING_PROVIDER=stripe. */
  @IsString()
  @IsOptional()
  STRIPE_SECRET_KEY?: string;

  // --- Secrets encryption (at rest) -------------------------------------
  /**
   * 32-byte AES-256 key for encrypting stored secrets (e.g. skill credentials):
   * 64 hex chars or base64 of 32 bytes. OPTIONAL — if unset, an insecure dev key
   * is derived (with a one-time warning) so local dev/tests work. MUST be set in
   * production.
   */
  @IsString()
  @IsOptional()
  ENCRYPTION_KEY?: string;
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
