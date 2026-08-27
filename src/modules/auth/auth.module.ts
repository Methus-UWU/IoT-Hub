import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UsersModule } from '../users/users.module';
import { ACCESS_TOKEN_LIFETIME } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaSessionRepository } from './prisma-session.repository';
import { SessionRepository } from './session.repository';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    { provide: SessionRepository, useClass: PrismaSessionRepository },
  ],
  imports: [
    PassportModule,
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: ACCESS_TOKEN_LIFETIME },
      }),
    }),
  ],
  exports: [JwtModule, JwtAuthGuard, SessionRepository],
})
export class AuthModule {}
