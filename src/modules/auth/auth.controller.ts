import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  THROTTLE_OVERRIDES,
  isProduction,
} from '../../common/config/security.config';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  CheckExistDto,
  LoginDto,
  SignUpDto,
  UpdateProfileDto,
} from './dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { CookieOptions, Request, Response } from 'express';
import type { AccessTokenPayload } from './strategies/jwt.strategy';

type AuthenticatedRequest = Request & { user: AccessTokenPayload };

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function refreshCookieOptions(): CookieOptions {
  return {
    ...refreshCookieBaseOptions(),
    maxAge: REFRESH_COOKIE_MAX_AGE,
  };
}

function refreshCookieBaseOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Fails closed: the cookie is Secure unless a developer explicitly opts out
    // for local HTTP, and production ignores that opt-out entirely. Keying this
    // off NODE_ENV alone sent refresh tokens in clear text whenever NODE_ENV was
    // simply unset.
    secure: isProduction() || process.env.ALLOW_INSECURE_COOKIES !== 'true',
    sameSite: 'lax',
    path: '/api/auth',
  };
}

function getRefreshToken(req: Request): string | undefined {
  const cookies: unknown = req.cookies;
  if (!cookies || typeof cookies !== 'object') return undefined;

  const token = (cookies as Record<string, unknown>)[REFRESH_COOKIE_NAME];
  return typeof token === 'string' ? token : undefined;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle(THROTTLE_OVERRIDES.auth)
  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(body, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.cookie(
      REFRESH_COOKIE_NAME,
      tokens.refreshToken,
      refreshCookieOptions(),
    );
    return { accessToken: tokens.accessToken };
  }

  // sign up method: user can register with username, email, password and personal info
  @Throttle(THROTTLE_OVERRIDES.auth)
  @Post('register')
  async register(@Body() body: SignUpDto) {
    return this.authService.signUp(body);
  }

  // sign out method: user must be authenticated to sign out, and it will delete the refresh token from database and clear the cookie
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(getRefreshToken(req));
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieBaseOptions());
  }

  // refresh token method: user can refresh access token by providing a valid refresh token in cookie, and it will return a new access token and refresh token
  @Throttle(THROTTLE_OVERRIDES.auth)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = getRefreshToken(req);

    if (!refreshToken) throw new UnauthorizedException('No refresh token');

    const tokens = await this.authService.refresh(refreshToken, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.cookie(
      REFRESH_COOKIE_NAME,
      tokens.refreshToken,
      refreshCookieOptions(),
    );

    return {
      accessToken: tokens.accessToken,
    };
  }

  // check exist method: user can check if a username or email already exists in the database, it will return true if exists and false if not
  @Throttle(THROTTLE_OVERRIDES.auth)
  @Get('availability')
  async checkExists(@Query() body: CheckExistDto) {
    return this.authService.checkExists(body);
  }

  // me method: user can get their own profile information, it will return the user information from the database, and it requires authentication
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Req() req: AuthenticatedRequest) {
    const uuid = req.user.sub;
    return this.authService.getMe(uuid);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateProfileDto,
  ) {
    return this.authService.updateMe(req.user.sub, body);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(THROTTLE_OVERRIDES.auth)
  @Patch('me/password')
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() body: ChangePasswordDto,
  ) {
    await this.authService.changePassword(req.user.sub, req.user.sid, body);
  }

  // forgot password method: user can request a password reset by providing their email, it will send a password reset link to the email if the email exists in the database
  @Throttle(THROTTLE_OVERRIDES.auth)
  @Post('forgot_password')
  async forgotPassword() {
    // return this.authService.forgotPassword(body.email);
  }
}
