import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthResponse, MeDto } from '@vaep/types';
import { AuthService } from './auth.service';
import { AuthenticatedUser, REFRESH_COOKIE } from './auth.provider';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const REFRESH_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { response, refreshToken } = await this.auth.register(dto);
    this.setRefreshCookie(res, refreshToken);
    return response;
  }

  @Post('login')
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

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeDto> {
    return this.auth.me(user.userId);
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/auth',
      maxAge: REFRESH_MAX_AGE_MS,
    });
  }
}
