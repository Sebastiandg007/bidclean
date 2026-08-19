import { Controller, Post, Get, Body, Query, UseGuards, Req, Headers, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { CallbackDto } from './dto/callback.dto';
import { RegisterBiometricDto } from './dto/register-biometric.dto';
import { BiometricVerifyDto } from './dto/biometric-verify.dto';
import { BiometricChallengeDto } from './dto/biometric-challenge.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { JwtUserPayload } from './guards/jwt.types';
import {
  AuthTokens,
  BiometricChallenge,
  CallbackResult,
  LoginUrlResponse,
  LogoutResponse,
  RegistrationResult,
  UserProfileResponse,
} from './auth.types';

/** Extended request with typed user payload from JWT guard */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * Authentication controller.
 *
 * Exposes endpoints for registration, login (via Keycloak redirect),
 * session management, and biometric authentication.
 */
@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() registerDto: RegisterDto): Promise<RegistrationResult> {
    return this.authService.register(registerDto);
  }

  @Get('login-url')
  getLoginUrl(@Query('redirectUri') redirectUri?: string): LoginUrlResponse {
    return this.authService.getKeycloakLoginUrl(redirectUri);
  }

  @Post('callback')
  async handleCallback(
    @Body() callbackDto: CallbackDto,
    @Req() req: Request,
    @Headers('x-forwarded-for') forwardedFor?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<CallbackResult> {
    const ipAddress = forwardedFor?.split(',')[0]?.trim() || req.ip || '0.0.0.0';

    return this.authService.handleKeycloakCallback({
      code: callbackDto.code,
      redirectUri: callbackDto.redirectUri,
      codeVerifier: callbackDto.codeVerifier,
      deviceId: callbackDto.deviceId,
      ipAddress,
      userAgent: userAgent || 'unknown',
    });
  }

  @Post('refresh')
  async refresh(@Body() body: { refreshToken: string }): Promise<AuthTokens> {
    return this.authService.refreshToken(body.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: AuthenticatedRequest): Promise<LogoutResponse> {
    return this.authService.logout(req.user.sessionState);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  async logoutAll(@Req() req: AuthenticatedRequest): Promise<LogoutResponse> {
    return this.authService.logoutAll(req.user.keycloakId);
  }

  @Post('biometric/register')
  @UseGuards(JwtAuthGuard)
  async registerBiometric(
    @Req() req: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    body: RegisterBiometricDto,
  ): Promise<void> {
    return this.authService.registerBiometric({
      userId: req.user.keycloakId,
      deviceId: body.deviceId,
      publicKey: body.publicKey,
      credentialType: body.credentialType,
    });
  }

  @Post('biometric/challenge')
  async getBiometricChallenge(
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    body: BiometricChallengeDto,
  ): Promise<BiometricChallenge> {
    return this.authService.generateBiometricChallenge(body.deviceId);
  }

  @Post('biometric/verify')
  async verifyBiometric(@Body() biometricVerifyDto: BiometricVerifyDto): Promise<AuthTokens> {
    return this.authService.verifyBiometric(biometricVerifyDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: AuthenticatedRequest): Promise<UserProfileResponse> {
    return this.authService.getCurrentUser(req.user.keycloakId);
  }
}
