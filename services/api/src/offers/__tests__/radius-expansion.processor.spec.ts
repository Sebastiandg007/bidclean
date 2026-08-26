/**
 * RadiusExpansionProcessor unit tests.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';

import { RadiusExpansionProcessor } from '../expansion/radius-expansion.processor';
import { OffersRepository } from '../offers.repository';
import { CLEANER_DISCOVERY } from '../discovery/cleaner-discovery.interface';
import { DeliverySchedulerService } from '../delivery/delivery-scheduler.service';
import { OfferStateMachineService } from '../state-machine/offer-state-machine';
import { OfferEventEmitterService } from '../events/offer-event-emitter.service';
import { OfferState } from '../offers.types';
import {
  OFFER_EXPANSION_INTERVAL_MS,
  OFFER_FINAL_WAIT_MS,
  QUEUE_NAMES,
} from '../offers.constants';
import { RadiusExpansionJobPayload } from '../expansion/radius-expansion.types';

describe('RadiusExpansionProcessor', () => {
  let processor: RadiusExpansionProcessor;
  let offersRepository: jest.Mocked<OffersRepository>;
  let cleanerDiscovery: jest.Mocked<{ findEligibleCleaners: jest.Mock }>;
  let deliveryScheduler: jest.Mocked<DeliverySchedulerService>;
  let stateMachine: jest.Mocked<OfferStateMachineService>;
  let eventEmitter: jest.Mocked<OfferEventEmitterService>;
  let dataSource: jest.Mocked<DataSource>;
  let expansionQueue: { add: jest.Mock };

  const baseOffer = {
    id: 'offer-1',
    hostId: 'host-1',
    propertyId: 'prop-1',
    state: OfferState.PUBLISHED,
    currentRadiusMeters: 3000,
    expansionStepCount: 0,
    favoritesFirst: false,
  };

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

  function buildJob(data: RadiusExpansionJobPayload): Job<RadiusExpansionJobPayload> {
    return { data } as Job<RadiusExpansionJobPayload>;
  }

  describe('process', () => {
    it('should skip stale jobs silently', async () => {
      offersRepository.findById.mockResolvedValue({
        ...baseOffer,
        expansionStepCount: 5,
      } as never);

      const result = await processor.process(
        buildJob({
          offerId: 'offer-1',
          expectedState: OfferState.PUBLISHED,
          expectedStep: 3, // mismatched step
        }),
      );

      expect(result.processed).toBe(false);
      expect(deliveryScheduler.deliverToCleaners).not.toHaveBeenCalled();
      expect(offersRepository.updateRadiusExpansion).not.toHaveBeenCalled();
    });

    it('should skip when offer not found', async () => {
      offersRepository.findById.mockResolvedValue(null);

      const result = await processor.process(
        buildJob({
          offerId: 'non-existent',
          expectedState: OfferState.PUBLISHED,
          expectedStep: 0,
        }),
      );

      expect(result.processed).toBe(false);
    });

    it('should expand radius by one step', async () => {
      offersRepository.findById.mockResolvedValue(baseOffer as never);

      const result = await processor.process(
        buildJob({
          offerId: 'offer-1',
          expectedState: OfferState.PUBLISHED,
          expectedStep: 0,
        }),
      );

      expect(result.processed).toBe(true);
      expect(result.currentRadiusMeters).toBe(5000); // 3000 + 2000
      expect(offersRepository.updateRadiusExpansion).toHaveBeenCalledWith(
        'offer-1',
        5000,
        1,
      );
    });

    it('should discover new Cleaners within expanded radius', async () => {
      offersRepository.findById.mockResolvedValue(baseOffer as never);
      const mockCleaners = [
        { cleanerId: 'c1', lat: 4.71, lng: -74.01, distanceMeters: 4000, tier: 'PRO' },
      ];
      cleanerDiscovery.findEligibleCleaners.mockResolvedValue(mockCleaners);

      const result = await processor.process(
        buildJob({
          offerId: 'offer-1',
          expectedState: OfferState.PUBLISHED,
          expectedStep: 0,
        }),
      );

      expect(result.newCleanersFound).toBe(1);
      expect(cleanerDiscovery.findEligibleCleaners).toHaveBeenCalledWith(
        expect.objectContaining({
          radiusMeters: 5000,
          hostId: 'host-1',
          excludeCleanerIds: [],
          favoritesFirst: false,
        }),
      );
    });

    it('should exclude already-delivered Cleaners', async () => {
      offersRepository.findById.mockResolvedValue(baseOffer as never);
      offersRepository.findDeliveredCleanerIds.mockResolvedValue(['c-already']);

      await processor.process(
        buildJob({
          offerId: 'offer-1',
          expectedState: OfferState.PUBLISHED,
          expectedStep: 0,
        }),
      );

      expect(cleanerDiscovery.findEligibleCleaners).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCleanerIds: ['c-already'],
        }),
      );
    });

    it('should enqueue next expansion job', async () => {
      offersRepository.findById.mockResolvedValue(baseOffer as never);

      await processor.process(
        buildJob({
          offerId: 'offer-1',
          expectedState: OfferState.PUBLISHED,
          expectedStep: 0,
        }),
      );

      expect(expansionQueue.add).toHaveBeenCalledWith(
        expect.stringContaining('expand-radius'),
        expect.objectContaining({
          offerId: 'offer-1',
          expectedStep: 1,
          expectedState: OfferState.PUBLISHED,
        }),
        { delay: OFFER_EXPANSION_INTERVAL_MS },
      );
    });

    it('should enqueue final-wait job at max radius', async () => {
      offersRepository.findById.mockResolvedValue({
        ...baseOffer,
        currentRadiusMeters: 24000, // 24000 + 2000 = 26000 > 25000, capped to 25000
      } as never);

      const result = await processor.process(
        buildJob({
          offerId: 'offer-1',
          expectedState: OfferState.PUBLISHED,
          expectedStep: 0,
        }),
      );

      expect(result.maxRadiusReached).toBe(true);
      expect(expansionQueue.add).toHaveBeenCalledWith(
        expect.stringContaining('final-wait'),
        expect.objectContaining({
          offerId: 'offer-1',
          isFinalWait: true,
        }),
        { delay: OFFER_FINAL_WAIT_MS },
      );
    });

    it('should expire offer after final wait', async () => {
      offersRepository.findById.mockResolvedValue({
        ...baseOffer,
        state: OfferState.ACTIVE,
        currentRadiusMeters: 25000,
      } as never);

      const result = await processor.process(
        buildJob({
          offerId: 'offer-1',
          expectedState: OfferState.ACTIVE,
          expectedStep: 0,
          isFinalWait: true,
        }),
      );

      expect(result.processed).toBe(true);
      expect(stateMachine.transitionState).toHaveBeenCalledWith(
        'offer-1',
        OfferState.ACTIVE,
        OfferState.EXPIRED,
        'radius_expansion_processor',
        expect.objectContaining({ reason: 'max_radius_final_wait_elapsed' }),
      );
      expect(eventEmitter.emitExpired).toHaveBeenCalledWith({
        offerId: 'offer-1',
        hostId: 'host-1',
        finalRadius: 25000,
      });
    });
  });
});
