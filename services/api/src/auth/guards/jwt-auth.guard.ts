import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { getKeycloakConfig } from '../keycloak/keycloak.config';
import { DecodedKeycloakToken, JwtUserPayload } from './jwt.types';

/**
 * JWT authentication guard.
 *
 * Validates Keycloak-issued JWTs by fetching the public key
 * from Keycloak's JWKS endpoint and verifying the token signature.
 * Attaches a typed user payload to request.user on success.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly jwksClient: jwksRsa.JwksClient;
  private readonly issuer: string;
  private readonly audience: string;

  constructor() {
    const config = getKeycloakConfig();
    const jwksUri = `${config.baseUrl}/realms/${config.realm}/protocol/openid-connect/certs`;

    this.issuer = `${config.baseUrl}/realms/${config.realm}`;
    this.audience = config.clientId;

    this.jwksClient = jwksRsa({
      jwksUri,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    const decoded = await this.verifyToken(token);
    const userPayload: JwtUserPayload = {
      keycloakId: decoded.sub,
      email: decoded.email,
      emailVerified: decoded.email_verified,
      sessionState: decoded.session_state,
    };

    // Attach user payload to request for downstream handlers
    (request as Request & { user: JwtUserPayload }).user = userPayload;

    return true;
  }

  private extractToken(request: Request): string | null {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      return null;
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return null;
    }

    return token;
  }

  private async verifyToken(token: string): Promise<DecodedKeycloakToken> {
    const getSigningKey = (
      header: jwt.JwtHeader,
      callback: jwt.SigningKeyCallback,
    ): void => {
      this.jwksClient.getSigningKey(header.kid, (err, key) => {
        if (err) {
          callback(err);
          return;
        }
        const signingKey = key?.getPublicKey();
        callback(null, signingKey);
      });
    };

    return new Promise<DecodedKeycloakToken>((resolve, reject) => {
      jwt.verify(
        token,
        getSigningKey,
        {
          algorithms: ['RS256'],
          issuer: this.issuer,
          audience: this.audience,
        },
        (err, decoded) => {
          if (err) {
            this.logger.warn(`JWT verification failed: ${err.message}`);
            reject(new UnauthorizedException(this.mapJwtError(err)));
            return;
          }
          resolve(decoded as DecodedKeycloakToken);
        },
      );
    });
  }

  private mapJwtError(err: jwt.VerifyErrors): string {
    if (err instanceof jwt.TokenExpiredError) {
      return 'Token expired';
    }
    if (err instanceof jwt.NotBeforeError) {
      return 'Token not yet valid';
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return 'Invalid token';
    }
    return 'Token verification failed';
  }
}
