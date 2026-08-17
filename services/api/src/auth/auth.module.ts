import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { KeycloakService } from './keycloak/keycloak.service';
import { EmailVerificationSyncService } from './keycloak/email-verification-sync.service';
import { SessionService } from './session/session.service';
import { BiometricService } from './biometric/biometric.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { User } from './entities/user.entity';
import { AuthSession } from './entities/auth-session.entity';
import { BiometricCredential } from './entities/biometric-credential.entity';
import { BiometricChallenge } from './entities/biometric-challenge.entity';

/**
 * Authentication module.
 *
 * Handles user registration, login (via Keycloak),
 * session tracking, and biometric authentication.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, AuthSession, BiometricCredential, BiometricChallenge]),
    ScheduleModule.forRoot(),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    KeycloakService,
    EmailVerificationSyncService,
    SessionService,
    BiometricService,
    JwtAuthGuard,
    RateLimitGuard,
  ],
  exports: [AuthService, EmailVerificationSyncService, JwtAuthGuard, RateLimitGuard],
})
export class AuthModule {}
