import { toStartedPayload } from '../consumers/started-payload.mapper';
import {
  isCompletionPrecondition,
  isPhotoRequiredPolicy,
  validateChecklistPhotosConfig,
} from '../checklist.constants';
import { ChecklistStartedConsumer } from '../consumers/checklist-started.consumer';
import { ChecklistRunCreationService } from '../service/checklist-run-creation.service';
import { ServiceOutboxEventType } from '../../service-tracking/service-tracking.types';

/**
 * Mock-heavy unit tests for checklist-photos (Spec 19): config validator, started-payload mapper,
 * and the started consumer's idempotent per-consumer draining. MinIO/BullMQ/Postgres are mocked;
 * NODE_ENV=test skips the fail-fast validator.
 */

describe('validateChecklistPhotosConfig', () => {
  it('is skipped under NODE_ENV=test (never throws)', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(() => validateChecklistPhotosConfig()).not.toThrow();
  });

  it('recognizes valid policy + precondition values', () => {
    expect(isPhotoRequiredPolicy('NONE')).toBe(true);
    expect(isPhotoRequiredPolicy('ALL_TASKS')).toBe(true);
    expect(isPhotoRequiredPolicy('BOGUS')).toBe(false);
    expect(isCompletionPrecondition('ALL_TASKS_DONE')).toBe(true);
    expect(isCompletionPrecondition('ALL_REQUIRED_PHOTOS')).toBe(true);
    expect(isCompletionPrecondition('nope')).toBe(false);
  });
});

describe('toStartedPayload', () => {
  it('maps event-carried snapshot + policies and coerces malformed fields to defaults', () => {
    const payload = toStartedPayload({
      sessionId: 's1',
      offerId: 'o1',
      propertyId: 'p1',
      hostId: 'h1',
      cleanerId: 'c1',
      checklistItems: ['a', 'b', 42, 'c'],
      photoRequiredPolicy: 'ALL_TASKS',
      completionPrecondition: 'BOGUS',
      maxPhotosPerTask: 3,
    });
    expect(payload.checklistItems).toEqual(['a', 'b', 'c']); // non-strings dropped
    expect(payload.photoRequiredPolicy).toBe('ALL_TASKS');
    expect(payload.completionPrecondition).toBe('NONE'); // invalid → default
    expect(payload.maxPhotosPerTask).toBe(3);
  });

  it('throws when a required id is missing (row stays re-drainable)', () => {
    expect(() => toStartedPayload({ offerId: 'o1' })).toThrow();
  });

  it('empty/absent checklist yields a zero-task snapshot', () => {
    const payload = toStartedPayload({ sessionId: 's1', offerId: 'o1' });
    expect(payload.checklistItems).toEqual([]);
  });
});

describe('ChecklistStartedConsumer', () => {
  const makeCheckpoint = () => ({
    drainUnacked: jest.fn(),
    ack: jest.fn().mockResolvedValue(undefined),
  });

  it('creates a run for a service_started row then acks its own (event_id, checklist)', async () => {
    const checkpoint = makeCheckpoint();
    checkpoint.drainUnacked.mockResolvedValue([
      {
        eventId: 'service_started:s1',
        type: ServiceOutboxEventType.STARTED,
        aggregateId: 's1',
        payload: { sessionId: 's1', offerId: 'o1', checklistItems: ['x'] },
      },
    ]);
    const creation = { createFromStarted: jest.fn().mockResolvedValue(true) } as unknown as ChecklistRunCreationService;
    const consumer = new ChecklistStartedConsumer(checkpoint as never, creation);
    await consumer.drainOnce();
    expect(creation.createFromStarted).toHaveBeenCalledTimes(1);
    expect(checkpoint.ack).toHaveBeenCalledWith('service_started:s1', 'checklist');
  });

  it('does not ack when creation fails (row stays re-drainable)', async () => {
    const checkpoint = makeCheckpoint();
    checkpoint.drainUnacked.mockResolvedValue([
      {
        eventId: 'service_started:s1',
        type: ServiceOutboxEventType.STARTED,
        aggregateId: 's1',
        payload: { sessionId: 's1', offerId: 'o1', checklistItems: [] },
      },
    ]);
    const creation = {
      createFromStarted: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as ChecklistRunCreationService;
    const consumer = new ChecklistStartedConsumer(checkpoint as never, creation);
    await consumer.drainOnce();
    expect(checkpoint.ack).not.toHaveBeenCalled();
  });

  it('acks (skips) an unrelated event type without creating a run', async () => {
    const checkpoint = makeCheckpoint();
    checkpoint.drainUnacked.mockResolvedValue([
      { eventId: 'service_arrived:s1', type: ServiceOutboxEventType.ARRIVED, aggregateId: 's1', payload: {} },
    ]);
    const creation = { createFromStarted: jest.fn() } as unknown as ChecklistRunCreationService;
    const consumer = new ChecklistStartedConsumer(checkpoint as never, creation);
    await consumer.drainOnce();
    expect(creation.createFromStarted).not.toHaveBeenCalled();
    expect(checkpoint.ack).toHaveBeenCalledWith('service_arrived:s1', 'checklist');
  });
});
