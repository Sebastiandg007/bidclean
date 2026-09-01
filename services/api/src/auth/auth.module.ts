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
import { CentrifugoController } from './centrifugo/centrifugo.controller';
import { CentrifugoTokenService } from './centrifugo/centrifugo-token.service';
import { User } from './entities/user.entity';
import { AuthSession } from './entities/auth-session.entity';
import { BiometricCredential } from './entities/biometric-credential.entity';
import { BiometricChallenge } from './entities/biometric-challenge.entity';
import { ChatModule } from '../chat/chat.module';

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
    ChatModule,
  ],
  controllers: [AuthController, CentrifugoController],
  providers: [
    AuthService,
    KeycloakService,
    EmailVerificationSyncService,
    SessionService,
    BiometricService,
    JwtAuthGuard,
    RateLimitGuard,
    CentrifugoTokenService,
  ],
  exports: [AuthService, KeycloakService, EmailVerificationSyncService, JwtAuthGuard, RateLimitGuard],
})
export class AuthModule {}
