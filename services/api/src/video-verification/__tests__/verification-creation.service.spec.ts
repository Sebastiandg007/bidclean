import { VerificationArrivalConsumer } from '../consumers/verification-arrival.consumer';
import { ArrivalPayload, VerificationState } from '../video-verification.types';
import { buildVerificationStack, VerificationStack } from './support/build-verification-stack';

function arrival(overrides: Partial<ArrivalPayload> = {}): ArrivalPayload {
  return {
    sessionId: 'sess-1',
    offerId: 'offer-1',
    cleanerId: 'cleaner-1',
    hostId: 'host-1',
    arrivalDistanceM: 10,
    ...overrides,
  };
}

describe('VerificationCreationService', () => {
  let stack: VerificationStack;

  beforeEach(() => {
    stack = buildVerificationStack();
  });

  it('creates exactly one PENDING_UPLOAD row with participants + snapshot threshold (enabled)', async () => {
    await stack.creationService.createFromArrival(arrival());
    expect(stack.db.verifications).toHaveLength(1);
    const row = stack.db.verifications[0];
    expect(row?.state).toBe(VerificationState.PENDING_UPLOAD);
    expect(row?.cleaner_id).toBe('cleaner-1');
    expect(row?.host_id).toBe('host-1');
    expect(row?.match_threshold).toBe('0.6000');
  });

  it('is idempotent across redeliveries — never a second row', async () => {
    await stack.creationService.createFromArrival(arrival());
    await stack.creationService.createFromArrival(arrival());
    await stack.creationService.createFromArrival(arrival());
    expect(stack.db.verifications).toHaveLength(1);
  });

  it('skips creation when the arrival has no cleaner (no throw)', async () => {
    await expect(
      stack.creationService.createFromArrival(arrival({ cleanerId: null })),
    ).resolves.toBeUndefined();
    expect(stack.db.verifications).toHaveLength(0);
  });
});

/** A minimal fake checkpoint driving the consumer over an in-memory outbox. */
class FakeCheckpoint {
  acked: Array<{ eventId: string; consumer: string }> = [];
  constructor(
    private readonly rows: Array<{
      eventId: string;
      type: string;
      aggregateId: string;
      payload: Record<string, unknown>;
    }>,
  ) {}

  async drainUnacked(): Promise<
    Array<{ eventId: string; type: string; aggregateId: string; payload: Record<string, unknown> }>
  > {
    return this.rows.filter((r) => !this.acked.some((a) => a.eventId === r.eventId));
  }

  async ack(eventId: string, consumer: string): Promise<void> {
    this.acked.push({ eventId, consumer });
  }
}

describe('VerificationArrivalConsumer', () => {
  let stack: VerificationStack;

  beforeEach(() => {
    stack = buildVerificationStack();
  });

  it('creates a verification for a service_arrived row and acks its own (event_id, video)', async () => {
    const checkpoint = new FakeCheckpoint([
      {
        eventId: 'service_arrived:sess-1',
        type: 'service_arrived',
        aggregateId: 'sess-1',
        payload: arrival() as unknown as Record<string, unknown>,
      },
    ]);
    const consumer = new VerificationArrivalConsumer(
      checkpoint as never,
      stack.creationService,
    );
    await consumer.drainOnce();
    expect(stack.db.verifications).toHaveLength(1);
    expect(checkpoint.acked).toEqual([{ eventId: 'service_arrived:sess-1', consumer: 'video' }]);
  });

  it('acks a non-arrival event as a no-op (does not create a verification)', async () => {
    const checkpoint = new FakeCheckpoint([
      {
        eventId: 'service_en_route:sess-1',
        type: 'service_en_route',
        aggregateId: 'sess-1',
        payload: arrival() as unknown as Record<string, unknown>,
      },
    ]);
    const consumer = new VerificationArrivalConsumer(checkpoint as never, stack.creationService);
    await consumer.drainOnce();
    expect(stack.db.verifications).toHaveLength(0);
    expect(checkpoint.acked).toHaveLength(1);
  });
});
