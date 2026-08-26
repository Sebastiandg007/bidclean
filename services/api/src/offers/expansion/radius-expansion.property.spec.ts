/**
 * Property-based tests for RadiusExpansionProcessor.
 *
 * Feature: offer-publishing
 * Tests radius expansion monotonicity and stale job idempotency.
 */
import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';

import { calculateExpandedRadius, RadiusExpansionProcessor } from './radius-expansion.processor';
import { isStaleJob } from './stale-job.guard';
import { OffersRepository } from '../offers.repository';
import { CLEANER_DISCOVERY } from '../discovery/cleaner-discovery.interface';
import { DeliverySchedulerService } from '../delivery/delivery-scheduler.service';
import { OfferStateMachineService } from '../state-machine/offer-state-machine';
import { OfferEventEmitterService } from '../events/offer-event-emitter.service';
import { OfferState } from '../offers.types';
import { QUEUE_NAMES } from '../offers.constants';
import { RadiusExpansionJobPayload } from './radius-expansion.types';

// Feature: offer-publishing, Property 22.1: Radius Expansion Monotonicity (Capped)
describe('Property 22.1: Radius Expansion Monotonicity (Capped)', () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any valid config and step count 0–20, the radius must equal
   * min(initialRadius + step * stepSize, maxRadius) and never exceed maxRadius.
   */
  it('radius = min(initial + step * size, max), never exceeds max', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50000 }),   // initialRadius
        fc.integer({ min: 0, max: 20 }),       // step
        fc.integer({ min: 1, max: 10000 }),    // stepSize
        fc.integer({ min: 1, max: 100000 }),   // maxRadius (before adjustment)
        (initialRadius, step, stepSize, rawMax) => {
          // Ensure max >= initial (valid config)
          const maxRadius = Math.max(rawMax, initialRadius);

          const radius = calculateExpandedRadius(initialRadius, step, stepSize, maxRadius);

          // Never exceeds max
          expect(radius).toBeLessThanOrEqual(maxRadius);

          // Equals expected formula
          const expected = Math.min(initialRadius + step * stepSize, maxRadius);
          expect(radius).toBe(expected);

          // Always >= initial (since step >= 0 and stepSize > 0)
          expect(radius).toBeGreaterThanOrEqual(initialRadius);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * Radius is monotonically non-decreasing as step increases.
   */
  it('radius is monotonically non-decreasing as step increases', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50000 }),   // initialRadius
        fc.integer({ min: 1, max: 10000 }),    // stepSize
        fc.integer({ min: 1, max: 100000 }),   // maxRadius (before adjustment)
        (initialRadius, stepSize, rawMax) => {
          const maxRadius = Math.max(rawMax, initialRadius);

          let previousRadius = 0;
          for (let step = 0; step <= 20; step++) {
            const radius = calculateExpandedRadius(initialRadius, step, stepSize, maxRadius);
            expect(radius).toBeGreaterThanOrEqual(previousRadius);
            previousRadius = radius;
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: offer-publishing, Property 22.2: Stale Job Idempotency
describe('Property 22.2: Stale Job Idempotency', () => {
  let processor: RadiusExpansionProcessor;
  let offersRepository: jest.Mocked<OffersRepository>;
  let cleanerDiscovery: { findEligibleCleaners: jest.Mock };
  let deliveryScheduler: jest.Mocked<DeliverySchedulerService>;
  let stateMachine: jest.Mocked<OfferStateMachineService>;
  let eventEmitter: jest.Mocked<OfferEventEmitterService>;
  let dataSource: jest.Mocked<DataSource>;
  let expansionQueue: { add: jest.Mock };

  beforeEach(async () => {
    offersRepository = {
      findById: jest.fn(),
      findDeliveredCleanerIds: jest.fn().mockResolvedValue([]),
      updateRadiusExpansion: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OffersRepository>;

    cleanerDiscovery = {
      findEligibleCleaners: jest.fn().mockResolvedValue([]),
    };

    deliveryScheduler = {
      deliverToCleaners: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeliverySchedulerService>;

    stateMachine = {
      transitionState: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<OfferStateMachineService>;

    eventEmitter = {
      emitExpired: jest.fn(),
    } as unknown as jest.Mocked<OfferEventEmitterService>;

    dataSource = {
      query: jest.fn().mockResolvedValue([{ lat: 4.7, lng: -74.0 }]),
    } as unknown as jest.Mocked<DataSource>;

    expansionQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadiusExpansionProcessor,
        { provide: OffersRepository, useValue: offersRepository },
        { provide: CLEANER_DISCOVERY, useValue: cleanerDiscovery },
        { provide: DeliverySchedulerService, useValue: deliveryScheduler },
        { provide: OfferStateMachineService, useValue: stateMachine },
        { provide: OfferEventEmitterService, useValue: eventEmitter },
        { provide: DataSource, useValue: dataSource },
        { provide: getQueueToken(QUEUE_NAMES.RADIUS_EXPANSION), useValue: expansionQueue },
      ],
    }).compile();

    processor = module.get<RadiusExpansionProcessor>(RadiusExpansionProcessor);
  });

  const allStates = Object.values(OfferState);

  /**
   * **Validates: Requirements 1.2**
   *
   * isStaleJob returns true for any mismatched state or step.
   */
  it('isStaleJob returns true for mismatched state or step', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allStates),       // currentState
        fc.integer({ min: 0, max: 20 }),      // currentStep
        fc.constantFrom(...allStates),       // expectedState
        fc.integer({ min: 0, max: 20 }),      // expectedStep
        (currentState, currentStep, expectedState, expectedStep) => {
          // Only test mismatched pairs
          fc.pre(currentState !== expectedState || currentStep !== expectedStep);

          const result = isStaleJob({
            currentState,
            currentStep,
            expectedState,
            expectedStep,
          });

          expect(result).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * When a job is stale (mismatched state or step), the processor
   * completes without calling any downstream services.
   */
  it('stale jobs complete without side effects', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...allStates),       // actual offer state
        fc.integer({ min: 0, max: 20 }),      // actual step count
        fc.constantFrom(OfferState.PUBLISHED, OfferState.ACTIVE), // expected state in job
        fc.integer({ min: 0, max: 20 }),      // expected step in job
        async (actualState, actualStep, jobExpectedState, jobExpectedStep) => {
          // Ensure the job IS stale (mismatch)
          fc.pre(actualState !== jobExpectedState || actualStep !== jobExpectedStep);

          offersRepository.findById.mockResolvedValue({
            id: 'offer-x',
            hostId: 'host-x',
            propertyId: 'prop-x',
            state: actualState,
            currentRadiusMeters: 5000,
            expansionStepCount: actualStep,
            favoritesFirst: false,
          } as never);

          const job = { data: {
            offerId: 'offer-x',
            expectedState: jobExpectedState,
            expectedStep: jobExpectedStep,
          } } as Job<RadiusExpansionJobPayload>;

          const result = await processor.process(job);

          expect(result.processed).toBe(false);
          expect(deliveryScheduler.deliverToCleaners).not.toHaveBeenCalled();
          expect(offersRepository.updateRadiusExpansion).not.toHaveBeenCalled();
          expect(expansionQueue.add).not.toHaveBeenCalled();

          // Reset mocks for next iteration
          jest.clearAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });
});
