import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: '15m',
        },
      }),
    }),
  ],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
