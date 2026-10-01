import { NoopFavoritesCacheService } from '../favorites.cache';

/**
 * Unit tests for the v1 no-op cache (Spec 22). It always misses (forcing the authoritative DB read)
 * and `set`/`invalidate` are no-ops — so v1 delivery always reads PostgreSQL.
 */
describe('NoopFavoritesCacheService', () => {
  const cache = new NoopFavoritesCacheService();

  it('getCleanerIds always misses (null)', async () => {
    await expect(cache.getCleanerIds('host-1')).resolves.toBeNull();
  });

  it('set and invalidate are no-ops that resolve', async () => {
    await expect(cache.set('host-1', ['c-1'])).resolves.toBeUndefined();
    await expect(cache.invalidate('host-1')).resolves.toBeUndefined();
    // Still a miss after set — nothing is cached in v1.
    await expect(cache.getCleanerIds('host-1')).resolves.toBeNull();
  });
});
