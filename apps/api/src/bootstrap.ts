import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';

/**
 * Shared app config (middleware/pipes/CORS) applied by both the long-running
 * process (main.ts, app.listen) and the Vercel serverless entry (api/index.ts,
 * no listen) so the two entrypoints can't drift apart.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.enableCors({
    origin: config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000',
    credentials: true,
  });
}
