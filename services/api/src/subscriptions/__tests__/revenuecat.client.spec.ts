import { ConfigService } from '@nestjs/config';
import { RevenueCatClient } from '../revenuecat/revenuecat.client';

/**
 * Unit tests for RevenueCatClient (mocked fetch).
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 4.1, 8.1 (subscriber fetch maps to entitlement snapshot; delete
 * handles 404; auth header attached; never throws into the reconciliation hot path).
 */

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: <T>(key: string, defaultValue?: T) => (values[key] as unknown as T) ?? defaultValue,
  } as unknown as ConfigService;
}

const CONFIG = configWith({
  REVENUECAT_API_KEY: 'sk_test',
  REVENUECAT_API_URL: 'https://api.revenuecat.com/v1',
  RC_ENTITLEMENT_CLEANER_PRO: 'cleaner_pro',
  RC_ENTITLEMENT_HOST_PRO: 'host_pro',
  RC_ENTITLEMENT_AD_FREE: 'ad_free',
});

describe('RevenueCatClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('maps a subscriber response to recognized entitlements with a Bearer header', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        subscriber: {
          entitlements: {
            cleaner_pro: { expires_date: future, store: 'app_store' },
            unknown_entitlement: { expires_date: future, store: 'app_store' },
          },
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new RevenueCatClient(CONFIG);
    const result = await client.getSubscriber('user-1');

    expect(result?.entitlements).toHaveLength(1);
    expect(result?.entitlements[0]).toMatchObject({ key: 'CLEANER_PRO', active: true, store: 'app_store' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test');
  });

  it('treats a 404 as a known subscriber with no entitlements', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    const client = new RevenueCatClient(CONFIG);
    const result = await client.getSubscriber('ghost');
    expect(result).toEqual({ userId: 'ghost', entitlements: [] });
  });

  it('returns null (unreachable) on a non-404 error without throwing', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const client = new RevenueCatClient(CONFIG);
    await expect(client.getSubscriber('user-1')).resolves.toBeNull();
  });

  it('returns null when fetch itself throws (network down)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const client = new RevenueCatClient(CONFIG);
    await expect(client.getSubscriber('user-1')).resolves.toBeNull();
  });

  it('deleteSubscriber succeeds on 200 and on 404 (idempotent)', async () => {
    const client = new RevenueCatClient(CONFIG);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
    await expect(client.deleteSubscriber('user-1')).resolves.toBeUndefined();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    await expect(client.deleteSubscriber('gone')).resolves.toBeUndefined();
  });

  it('deleteSubscriber throws on an unexpected non-404 error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const client = new RevenueCatClient(CONFIG);
    await expect(client.deleteSubscriber('user-1')).rejects.toThrow(/HTTP 500/);
  });
});
