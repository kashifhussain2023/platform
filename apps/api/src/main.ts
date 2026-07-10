import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // rawBody: true buffers the raw request body (exposed as req.rawBody) so the
  // Stripe webhook can verify its signature. JSON parsing is unaffected — normal
  // routes still receive a parsed req.body and the global ValidationPipe applies.
  const app = await NestFactory.create(AppModule, { rawBody: true });
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

  const port = Number(config.get<string>('PORT') ?? '4000');
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[v-aep/api] listening on http://localhost:${port}`);
}

void bootstrap();
