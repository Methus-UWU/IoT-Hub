import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import {
  BUILD_RESULT_BODY_LIMIT,
  REQUEST_BODY_LIMIT,
  corsOrigins,
  isProduction,
  trustProxySetting,
} from './common/config/security.config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind nginx every request would otherwise come from the proxy, which breaks
  // sign-in history addresses and per-client throttling alike.
  const trustProxy = trustProxySetting();
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  app.enableShutdownHooks();

  app.setGlobalPrefix('api');
  app.use(helmet());

  // Bounded bodies. The workspace file editor is the largest legitimate payload
  // from a browser. A build result carries base64 firmware images, so the
  // worker-only route gets its own ceiling; it is registered first, and the
  // general parser then skips a body that is already parsed.
  app.use(
    '/api/internal/build-jobs',
    express.json({ limit: BUILD_RESULT_BODY_LIMIT }),
  );
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
