import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
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
