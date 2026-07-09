import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';

/**
 * Global config module. ConfigService is exposed everywhere as a singleton.
 * Reads apps/api/.env first, then falls back to the repo-root .env.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
