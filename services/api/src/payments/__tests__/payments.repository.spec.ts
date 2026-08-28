import { DataSource } from 'typeorm';
import { PaymentsRepository } from '../payments.repository';
import { PaymentEvent } from '../entities/payment-event.entity';
import { PaymentEventSource } from '../payments.types';

/**
 * Repository unit tests focused on the pure/branching logic that does not require a
 * live database: webhook dedup via unique-violation swallowing (P8) and event append.
 * Full atomic-transition behavior is covered by the integration tests (Task 18).
 */
describe('PaymentsRepository (dedup + append)', () => {
  function buildRepo(saveImpl: jest.Mock, countImpl?: jest.Mock) {
    const eventRepo = {
      create: (x: unknown) => x,
      save: saveImpl,
      count: countImpl ?? jest.fn(),
    };
    const dataSource = {
      getRepository: (entity: unknown) => {
        if (entity === PaymentEvent) {
          return eventRepo;
        }
        return { findOne: jest.fn(), find: jest.fn(), count: jest.fn() };
      },
    } as unknown as DataSource;
    return { repo: new PaymentsRepository(dataSource), eventRepo };
  }

  it('appends a sanitized event to the ledger', async () => {
    const save = jest.fn().mockResolvedValue({ id: 'e1' });
    const { repo } = buildRepo(save);
    await repo.appendEvent({
      paymentId: 'p1',
      source: PaymentEventSource.WEBHOOK,
      eventType: 'payment_intent.succeeded',
      stripeEventId: 'evt_1',
      payload: { eventId: 'evt_1' },
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('swallows a duplicate webhook event (unique violation, P8)', async () => {
    const save = jest.fn().mockRejectedValue({ code: '23505' });
    const { repo } = buildRepo(save);
    await expect(
      repo.appendEvent({
        paymentId: 'p1',
        source: PaymentEventSource.WEBHOOK,
        eventType: 'payment_intent.succeeded',
        stripeEventId: 'evt_dup',
        payload: {},
      }),
    ).resolves.toBeUndefined();
  });

  it('rethrows non-unique-violation errors when appending', async () => {
    const save = jest.fn().mockRejectedValue(new Error('db down'));
    const { repo } = buildRepo(save);
    await expect(
      repo.appendEvent({
        paymentId: 'p1',
        source: PaymentEventSource.API,
        eventType: 'refund',
        payload: {},
      }),
    ).rejects.toThrow('db down');
  });

  it('reports processed events via count', async () => {
    const count = jest.fn().mockResolvedValue(1);
    const { repo } = buildRepo(jest.fn(), count);
    await expect(repo.hasProcessedStripeEvent('evt_1')).resolves.toBe(true);
    count.mockResolvedValue(0);
    await expect(repo.hasProcessedStripeEvent('evt_2')).resolves.toBe(false);
  });
});
