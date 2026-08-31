import {
  computeSignature,
  verifyWebhook,
  WebhookAuthConfig,
} from '../revenuecat/revenuecat-signature';

/**
 * Unit tests for the RevenueCat webhook signature verifier.
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 2.2, P3 (webhook authenticity — HMAC, replay guard, constant-time,
 * bearer fallback).
 */
describe('verifyWebhook', () => {
  const NOW_MS = 1_700_000_000_000;
  const rawBody = '{"event":{"id":"evt_1","type":"RENEWAL"}}';

  const hmacConfig: WebhookAuthConfig = {
    signingSecret: 'signing-secret',
    authSecret: '',
    toleranceSeconds: 300,
  };

  function signedInput(timestampMs: number) {
    const timestampHeader = String(timestampMs);
    return {
      rawBody,
      signatureHeader: computeSignature(rawBody, timestampHeader, hmacConfig.signingSecret),
      timestampHeader,
      authorizationHeader: null,
    };
  }

  it('accepts a valid HMAC signature within the tolerance window', () => {
    const result = verifyWebhook(signedInput(NOW_MS), hmacConfig, NOW_MS);
    expect(result.ok).toBe(true);
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const input = { ...signedInput(NOW_MS), rawBody: rawBody + 'tampered' };
    const result = verifyWebhook(input, hmacConfig, NOW_MS);
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects a wrong signature', () => {
    const input = { ...signedInput(NOW_MS), signatureHeader: 'deadbeef' };
    const result = verifyWebhook(input, hmacConfig, NOW_MS);
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects a stale timestamp beyond tolerance (replay guard)', () => {
    const staleMs = NOW_MS - 301_000; // 301s old, tolerance 300s
    const result = verifyWebhook(signedInput(staleMs), hmacConfig, NOW_MS);
    expect(result).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects a future timestamp beyond tolerance', () => {
    const futureMs = NOW_MS + 301_000;
    const result = verifyWebhook(signedInput(futureMs), hmacConfig, NOW_MS);
    expect(result).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects when the signature header is missing', () => {
    const result = verifyWebhook(
      { rawBody, signatureHeader: null, timestampHeader: String(NOW_MS), authorizationHeader: null },
      hmacConfig,
      NOW_MS,
    );
    expect(result).toEqual({ ok: false, reason: 'missing_signature' });
  });

  describe('bearer fallback (no signing secret configured)', () => {
    const bearerConfig: WebhookAuthConfig = {
      signingSecret: '',
      authSecret: 'shared-bearer',
      toleranceSeconds: 300,
    };

    it('accepts a matching bearer token', () => {
      const result = verifyWebhook(
        { rawBody, signatureHeader: null, timestampHeader: null, authorizationHeader: 'Bearer shared-bearer' },
        bearerConfig,
        NOW_MS,
      );
      expect(result.ok).toBe(true);
    });

    it('rejects a wrong bearer token', () => {
      const result = verifyWebhook(
        { rawBody, signatureHeader: null, timestampHeader: null, authorizationHeader: 'Bearer wrong' },
        bearerConfig,
        NOW_MS,
      );
      expect(result).toEqual({ ok: false, reason: 'invalid_bearer' });
    });

    it('rejects a missing authorization header', () => {
      const result = verifyWebhook(
        { rawBody, signatureHeader: null, timestampHeader: null, authorizationHeader: null },
        bearerConfig,
        NOW_MS,
      );
      expect(result).toEqual({ ok: false, reason: 'missing_bearer' });
    });
  });

  it('rejects when no secret is configured at all', () => {
    const result = verifyWebhook(
      { rawBody, signatureHeader: 'x', timestampHeader: String(NOW_MS), authorizationHeader: 'Bearer y' },
      { signingSecret: '', authSecret: '', toleranceSeconds: 300 },
      NOW_MS,
    );
    expect(result).toEqual({ ok: false, reason: 'no_secret_configured' });
  });
});
