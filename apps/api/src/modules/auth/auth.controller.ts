import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthResponse, MeDto } from '@vaep/types';
import { AuthService } from './auth.service';
import { AuthenticatedUser, REFRESH_COOKIE } from './auth.provider';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const REFRESH_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
// Tighter than the app-wide default (docs status audit §3): brute-force /
// signup-spam protection on the two unauthenticated entry points.
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle(AUTH_THROTTLE)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { response, refreshToken } = await this.auth.register(dto);
    this.setRefreshCookie(res, refreshToken);
    return response;
  }

  @Post('login')
  @Throttle(AUTH_THROTTLE)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { response, refreshToken } = await this.auth.login(dto);
    this.setRefreshCookie(res, refreshToken);
    return response;
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    const { response, refreshToken } = await this.auth.refresh(token);
    this.setRefreshCookie(res, refreshToken);
    return response;
  }

  /**
   * Clears the httpOnly refresh cookie so a "logged out" browser can't
   * silently re-authenticate on its next full page load. Previously the
   * frontend's logout was entirely client-side (in-memory state only) --
   * the still-valid cookie meant AuthBootstrap would exchange it for a new
   * access token on the very next reload/navigation, bouncing the user
   * straight back into the app (reported bug: logout appears to redirect
   * to /dashboard instead of logging out). No guard: clearing a cookie is
   * harmless and idempotent whether or not the caller is authenticated.
   */
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.clearCookie(REFRESH_COOKIE, this.refreshCookieOptions());
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeDto> {
    return this.auth.me(user.userId);
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      ...this.refreshCookieOptions(),
      maxAge: REFRESH_MAX_AGE_MS,
    });
  }

  /** Attributes shared by set + clear -- must match exactly or the browser
   * treats them as different cookies and won't actually clear it. */
  private refreshCookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/auth',
    };
  }
}
