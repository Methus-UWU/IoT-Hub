import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import {
  REQUEST_BODY_LIMIT,
  corsOrigins,
  isProduction,
} from './common/config/security.config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.use(helmet());

  // Bounded bodies. The workspace file editor is the largest legitimate payload.
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: REQUEST_BODY_LIMIT }));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const origins = corsOrigins();
  if (origins.length === 0) {
    // Fail closed: an unconfigured production deployment serves no browser origin
    // rather than silently accepting every one of them.
    logger.warn(
      'No CORS origin configured. Set CORS_ORIGINS before serving a browser client.',
    );
  }
  app.enableCors({
    origin: origins,
    credentials: true,
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on port ${port} (production=${isProduction()})`);
}

void bootstrap();
