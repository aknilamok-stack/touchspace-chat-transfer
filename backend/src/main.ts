import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const uploadsDir = join(process.cwd(), 'uploads');
  const defaultAllowedOrigins = [
    'http://localhost:3000',
    'https://app.example.ru',
    'https://b2btest.touchspace.biz',
    'https://b2b.touchspace.biz',
    'https://touchspace.biz',
  ];
  const configuredAllowedOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }

  const allowedOrigins = Array.from(
    new Set([...defaultAllowedOrigins, ...configuredAllowedOrigins]),
  );
  const allowVercelPreviews =
    (process.env.ALLOW_VERCEL_PREVIEWS ?? 'false') === 'true';
  const vercelPreviewPattern = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (
        allowedOrigins.includes(origin) ||
        (allowVercelPreviews && vercelPreviewPattern.test(origin))
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
    credentials: true,
  });

  app.use('/uploads', express.static(uploadsDir));

  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
void bootstrap();
