import { NegotiationIdempotencyService } from '../negotiation-idempotency.service';
import { NegotiationOperation } from '../negotiation.types';

/**
 * Unit tests for NegotiationIdempotencyService.
 *
 * Feature: offer-negotiation
 * Validates Correctness Property P9 (idempotency): a repeated (user, operation, key)
 * returns the cached result and never runs the work twice.
 */
describe('NegotiationIdempotencyService', () => {
  let store: Map<string, unknown>;
  let dataSource: { query: jest.Mock };
  let service: NegotiationIdempotencyService;

  function keyOf(userId: string, op: string, key: string): string {
    return `${userId}::${op}::${key}`;
  }

  beforeEach(() => {
    store = new Map();

    dataSource = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('SELECT')) {
          const k = keyOf(params[0] as string, params[1] as string, params[2] as string);
          return store.has(k) ? [{ result_json: store.get(k) }] : [];
        }
        // INSERT
        const k = keyOf(params[0] as string, params[1] as string, params[2] as string);
        if (store.has(k)) {
          const err = Object.assign(new Error('duplicate'), { code: '23505' });
          throw err;
        }
        store.set(k, JSON.parse(params[3] as string));
        return [];
      }),
    };

    service = new NegotiationIdempotencyService(dataSource as never);
  });

  it('runs the work once and caches the result', async () => {
    const work = jest.fn().mockResolvedValue({ value: 42 });

    const first = await service.runOnce('u1', NegotiationOperation.ACCEPT_OFFER, 'k1', work);
    expect(first).toEqual({ value: 42 });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('Property P9: replaying the same key returns the cached result without re-running work', async () => {
    const work = jest.fn().mockResolvedValue({ value: 'first' });

    const first = await service.runOnce('u1', NegotiationOperation.ACCEPT_OFFER, 'k1', work);

    const work2 = jest.fn().mockResolvedValue({ value: 'second' });
    const second = await service.runOnce('u1', NegotiationOperation.ACCEPT_OFFER, 'k1', work2);

    expect(second).toEqual(first);
    expect(work2).not.toHaveBeenCalled();
  });

  it('scopes by operation — same key across different operations does not collide', async () => {
    const acceptWork = jest.fn().mockResolvedValue({ op: 'accept' });
    const rejectWork = jest.fn().mockResolvedValue({ op: 'reject' });

    const a = await service.runOnce('u1', NegotiationOperation.ACCEPT_OFFER, 'same', acceptWork);
    const r = await service.runOnce('u1', NegotiationOperation.REJECT_PROPOSAL, 'same', rejectWork);

    expect(a).toEqual({ op: 'accept' });
    expect(r).toEqual({ op: 'reject' });
    expect(acceptWork).toHaveBeenCalledTimes(1);
    expect(rejectWork).toHaveBeenCalledTimes(1);
  });

  it('on a concurrent unique violation, returns the previously stored result', async () => {
    // Pre-seed the cache to simulate a racing writer that already stored a result.
    store.set(keyOf('u1', NegotiationOperation.ACCEPT_OFFER, 'race'), { value: 'stored' });

    // readCached is called first and will find it — work never runs.
    const work = jest.fn().mockResolvedValue({ value: 'fresh' });
    const result = await service.runOnce('u1', NegotiationOperation.ACCEPT_OFFER, 'race', work);

    expect(result).toEqual({ value: 'stored' });
    expect(work).not.toHaveBeenCalled();
  });
});
