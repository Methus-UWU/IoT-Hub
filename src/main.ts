import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:4200',
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
