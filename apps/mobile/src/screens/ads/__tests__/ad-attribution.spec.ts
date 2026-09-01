/**
 * Unit tests for `deriveAdAttributionId` — privacy-scoped pseudonym.
 *
 * Validates: Requirements 5.1, 6.2 / Property 9. The id is stable, purpose-separated, and NEVER
 * the raw internal UUID. A deterministic local `expo-crypto` mock echoes the digested material so
 * we can assert the exact derivation shape (the global setup mock returns a fixed digest, which
 * would hide these properties).
 */

// Local deterministic digest mock: returns the material itself, prefixed, so tests can inspect
// what was hashed and assert stability/purpose-separation without a native crypto backend.
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(
    async (_algo: string, data: string) => `digest(${data})`,
  ),
}));

import { deriveAdAttributionId } from '../ad-attribution';

const RAW_UUID = '11111111-2222-4333-8444-555555555555';

describe('deriveAdAttributionId', () => {
  it('never returns the raw internal UUID', async () => {
    const id = await deriveAdAttributionId(RAW_UUID);
    expect(id).not.toBe(RAW_UUID);
  });

  it('is stable for the same input', async () => {
    const a = await deriveAdAttributionId(RAW_UUID);
    const b = await deriveAdAttributionId(RAW_UUID);
    expect(a).toBe(b);
  });

  it('differs for different users', async () => {
    const a = await deriveAdAttributionId('user-a');
    const b = await deriveAdAttributionId('user-b');
    expect(a).not.toBe(b);
  });

  it('is purpose-separated (the ads purpose tag participates in the derivation)', async () => {
    const id = await deriveAdAttributionId(RAW_UUID);
    // The echoed material must include the ads purpose separation and the user id together.
    expect(id).toContain(':ads');
    expect(id).toContain(RAW_UUID);
    // And it is a derived digest, not the bare id.
    expect(id.startsWith('digest(')).toBe(true);
  });
});
