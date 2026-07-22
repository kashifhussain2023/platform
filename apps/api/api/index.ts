import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'http';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

/**
 * Vercel serverless entry (HTTP only — no app.listen, no BullMQ workers; see
 * QUEUE_WORKERS_ENABLED in queue-workers.ts, which this deployment must set to
 * `false`). main.ts remains the entrypoint for the long-running deployment that
 * also runs the queue workers.
 */
const server = express();
let ready: Promise<void> | undefined;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    rawBody: true,
  });
  configureApp(app);
  await app.init();
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!ready) ready = bootstrap();
  await ready;
  server(req, res);
}
