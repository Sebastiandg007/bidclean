import { ServiceSweepProcessor } from '../service-sweep.processor';
import { ServiceSessionRepository } from '../service-session.repository';
import { ServiceRealtimePublisher } from '../service-session.service';
import { EndedReason, SessionState } from '../service-tracking.types';
import { Queue } from 'bullmq';

/**
 * Unit tests for ServiceSweepProcessor (Spec 17).
 *
 * The abandon + stale sweeps each force-expire via a single-winner transition with a differentiated
 * `ended_reason`. A lost race (transition returns null) publishes nothing. Bounded + idempotent.
 */

function buildProcessor(
  overrides: Partial<ServiceSessionRepository> = {},
  publish: jest.Mock = jest.fn().mockResolvedValue(true),
): { processor: ServiceSweepProcessor; repo: ServiceSessionRepository; publish: jest.Mock } {
  const repo = {
    findAbandonedMatched: jest.fn().mockResolvedValue([]),
    findExpirableEnRoute: jest.fn().mockResolvedValue([]),
    transition: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as ServiceSessionRepository;
  const publisher: ServiceRealtimePublisher = { publish };
  const queue = { add: jest.fn() } as unknown as Queue;
  const processor = new ServiceSweepProcessor(queue, repo, publisher);
  return { processor, repo, publish };
}

describe('ServiceSweepProcessor', () => {
  it('abandon sweep expires MATCHED with EXPIRED_NEVER_STARTED (single-winner)', async () => {
    const { processor, repo, publish } = buildProcessor({
      findAbandonedMatched: jest.fn().mockResolvedValue(['s1']),
      transition: jest.fn().mockResolvedValue({ id: 's1' }),
    });
    await processor.sweepAbandoned();
    expect(repo.transition).toHaveBeenCalledWith(
      's1',
      SessionState.MATCHED,
      SessionState.EXPIRED,
      { endedReason: EndedReason.EXPIRED_NEVER_STARTED },
      null,
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('stale sweep expires EN_ROUTE with EXPIRED_NO_PROGRESS', async () => {
    const { processor, repo } = buildProcessor({
      findExpirableEnRoute: jest.fn().mockResolvedValue(['s2']),
      transition: jest.fn().mockResolvedValue({ id: 's2' }),
    });
    await processor.sweepStaleEnRoute();
    expect(repo.transition).toHaveBeenCalledWith(
      's2',
      SessionState.EN_ROUTE,
      SessionState.EXPIRED,
      { endedReason: EndedReason.EXPIRED_NO_PROGRESS },
      null,
    );
  });

  it('a lost race (transition null) publishes nothing (idempotent no-op)', async () => {
    const { processor, publish } = buildProcessor({
      findAbandonedMatched: jest.fn().mockResolvedValue(['s1']),
      transition: jest.fn().mockResolvedValue(null),
    });
    await processor.sweepAbandoned();
    expect(publish).not.toHaveBeenCalled();
  });

  it('a batch continues past a per-item transition failure', async () => {
    const transition = jest
      .fn()
      .mockRejectedValueOnce(new Error('row locked'))
      .mockResolvedValue({ id: 's4' });
    const { processor } = buildProcessor({
      findAbandonedMatched: jest.fn().mockResolvedValue(['s3', 's4']),
      transition,
    });
    await expect(processor.sweepAbandoned()).resolves.toBeUndefined();
  });
});
