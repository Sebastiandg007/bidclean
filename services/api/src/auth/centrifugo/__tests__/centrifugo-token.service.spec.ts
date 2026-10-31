import * as jwt from 'jsonwebtoken';

import { CentrifugoTokenService } from '../centrifugo-token.service';

/**
 * Unit tests for CentrifugoTokenService.
 *
 * Validates: Requirements 4.1, 4.2 / P10 (token scoping), P11 (integrity & expiry). The signing
 * secret is injected via env before importing the constants the service reads.
 */

// The service reads CENTRIFUGO_TOKEN_SECRET from chat.constants at import time; the shared value
// is seeded in test/setup-env.ts (runs before the module graph loads).
const SECRET = 'test-centrifugo-secret';

describe('CentrifugoTokenService', () => {
  const service = new CentrifugoTokenService();

  it('mints a connection token whose subject is the given user id (P10)', () => {
    const token = service.mintConnectionToken('user-1');
    const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload;
    expect(decoded.sub).toBe('user-1');
    expect(decoded.channel).toBeUndefined();
  });

  it('mints a subscription token scoped to the channel and subject (P10)', () => {
    const token = service.mintSubscriptionToken('user-1', 'chat:conversation:abc');
    const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload;
    expect(decoded.sub).toBe('user-1');
    expect(decoded.channel).toBe('chat:conversation:abc');
  });

  it('sets a bounded expiry (P11)', () => {
    const token = service.mintConnectionToken('user-1');
    const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload;
    expect(typeof decoded.exp).toBe('number');
    expect(typeof decoded.iat).toBe('number');
    expect((decoded.exp ?? 0) > (decoded.iat ?? 0)).toBe(true);
  });

  it('produces a token rejected under a different secret (integrity, P11)', () => {
    const token = service.mintConnectionToken('user-1');
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });

  it('produces a token rejected once expired (P11)', () => {
    const token = service.mintConnectionToken('user-1');
    // Verify with a negative clock tolerance far past the TTL to force expiry.
    expect(() => jwt.verify(token, SECRET, { clockTimestamp: 10_000_000_000 })).toThrow(
      jwt.TokenExpiredError,
    );
  });
});
