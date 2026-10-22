import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { THROTTLE_OVERRIDES } from '../../common/config/security.config';
import { AuthService } from './auth.service';
import { CheckExistDto, UpdateProfileDto } from './dto';
import { LoginHistoryService } from './login-history.service';
import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from './supabase-auth.guard';

/**
 * Profile and sign-in history endpoints only.
 *
 * Registration, login, logout, token refresh, email verification, password reset,
 * and OAuth (Google, GitHub) are performed by the Angular client directly against
 * Supabase Auth. The API never sees a password and never issues a token, so the
 * previous /login, /register, /logout, /refresh, /forgot_password, and
 * /me/password routes no longer exist.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly loginHistory: LoginHistoryService,
  ) {}

  @UseGuards(SupabaseAuthGuard)
  @Get('me')
  getMe(@Req() request: AuthenticatedRequest) {
    return this.authService.getMe(request.user.id);
  }

  @UseGuards(SupabaseAuthGuard)
  @Patch('me')
  updateMe(
    @Req() request: AuthenticatedRequest,
    @Body() body: UpdateProfileDto,
  ) {
    return this.authService.updateMe(request.user.id, body);
  }

  /**
   * Reports the caller's current session as a sign-in. Idempotent per session, so
   * the client calls it on every start rather than tracking whether it already did.
   */
  @UseGuards(SupabaseAuthGuard)
  @Post('login-events')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordLogin(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.loginHistory.record(
      request.user,
      request.ip,
      request.get('user-agent'),
    );
  }

  @UseGuards(SupabaseAuthGuard)
  @Get('login-events')
  listLogins(@Req() request: AuthenticatedRequest) {
    return this.loginHistory.list(request.user.id);
  }

  /**
   * Unauthenticated by necessity — the sign-up form needs it before an account
   * exists. Throttled at the auth tier because it is an enumeration oracle.
   */
  @Throttle(THROTTLE_OVERRIDES.auth)
  @Get('availability')
  checkExists(@Query() query: CheckExistDto) {
    return this.authService.checkExists(query);
  }
}
