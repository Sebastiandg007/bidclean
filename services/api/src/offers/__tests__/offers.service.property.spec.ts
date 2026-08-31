import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { OffersService } from '../offers.service';
import { OffersRepository } from '../offers.repository';
import { CommissionService } from '../commission/commission.service';
import { OfferEventEmitterService } from '../events/offer-event-emitter.service';
import { OfferStateMachineService } from '../state-machine/offer-state-machine';
import { CentrifugoClient } from '../delivery/centrifugo.client';
import { PROPERTY_READINESS } from '../contracts/property-readiness.interface';
import { COMMISSION_RATES } from '../../commission/contracts/commission-rates.interface';
import { OfferState, ServiceType } from '../offers.types';
import {
  OFFER_MIN_LEAD_MINUTES,
  OFFER_MIN_DURATION_MINUTES,
  OFFER_MAX_DURATION_MINUTES,
  QUEUE_NAMES,
} from '../offers.constants';

/**
 * Property-based tests for OffersService create flow.
 *
 * Feature: offer-publishing
 *
 * Validates: Requirements 1.2, 1.5, 1.6, 1.7, 1.8, 2.1, 2.3
 */
describe('OffersService — Create Flow Property-Based Tests', () => {
  let service: OffersService;
  let mockRepository: {
    create: jest.Mock;
    insertStateTransition: jest.Mock;
    findByIdempotencyKey: jest.Mock;
  };
  let mockEventEmitter: Record<string, jest.Mock>;
  let mockPropertyReadiness: { check: jest.Mock };

  /** Valid base DTO for testing — all required fields present and valid */
  const buildValidDto = (overrides: Record<string, unknown> = {}) => ({
    propertyId: 'prop-uuid-1234',
    serviceType: ServiceType.STANDARD,
    offeredPriceCents: 5000,
    scheduledAt: new Date(Date.now() + (OFFER_MIN_LEAD_MINUTES + 30) * 60 * 1000),
    timezone: 'America/Bogota',
    estimatedDurationMinutes: 60,
    currency: 'COP',
    ...overrides,
  });

  beforeEach(async () => {
    mockRepository = {
      create: jest.fn().mockResolvedValue({ id: 'offer-uuid-generated' }),
      insertStateTransition: jest.fn().mockResolvedValue({}),
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
    };

    mockEventEmitter = {
      emitCreated: jest.fn(),
    };

    mockPropertyReadiness = {
      check: jest.fn().mockResolvedValue({ ready: true, reasons: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OffersService,
        { provide: OffersRepository, useValue: mockRepository },
        { provide: CommissionService, useValue: new CommissionService() },
        { provide: OfferEventEmitterService, useValue: mockEventEmitter },
        { provide: OfferStateMachineService, useValue: { transitionState: jest.fn() } },
        { provide: DataSource, useValue: { query: jest.fn().mockResolvedValue([{ address_country: 'CO' }]) } },
        { provide: CentrifugoClient, useValue: { publish: jest.fn().mockResolvedValue(true), broadcast: jest.fn().mockResolvedValue(true) } },
        { provide: PROPERTY_READINESS, useValue: mockPropertyReadiness },
        {
          provide: COMMISSION_RATES,
          useValue: {
            resolveHostRate: jest.fn().mockResolvedValue({ rateBps: 1000, ruleId: null }),
            resolveCleanerRate: jest.fn().mockResolvedValue({ rateBps: 300, ruleId: null }),
            previewHostRate: jest.fn(),
            previewCleanerRate: jest.fn(),
          },
        },
        { provide: getQueueToken(QUEUE_NAMES.RADIUS_EXPANSION), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<OffersService>(OffersService);
  });

  // Feature: offer-publishing, Property 1: Price Validation — Positive Only
  describe('Property 16.1: Price Validation — Positive Only', () => {
    /**
     * Validates: Requirements 1.5
     *
     * Generate random integers from -1_000_000 to 1_000_000.
     * Assert: only positive integers (>0) pass validation; zero and negative values are rejected.
     */
    it('only positive integers pass price validation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -1_000_000, max: 1_000_000 }),
          async (priceCents: number) => {
            const dto = buildValidDto({ offeredPriceCents: priceCents });

            if (priceCents > 0 && Number.isInteger(priceCents)) {
              const result = await service.create('host-123', dto as never);
              expect(result).toHaveProperty('id');
            } else {
              await expect(
                service.create('host-123', dto as never),
              ).rejects.toThrow(BadRequestException);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-publishing, Property 2: Duration Bounds Validation
  describe('Property 16.2: Duration Bounds Validation', () => {
    /**
     * Validates: Requirements 1.7
     *
     * Generate random integers from 0 to 1000.
     * Assert: only values in [OFFER_MIN_DURATION_MINUTES, OFFER_MAX_DURATION_MINUTES] pass.
     */
    it('only durations within configured bounds pass validation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 1000 }),
          async (duration: number) => {
            const dto = buildValidDto({ estimatedDurationMinutes: duration });

            const withinBounds =
              duration >= OFFER_MIN_DURATION_MINUTES &&
              duration <= OFFER_MAX_DURATION_MINUTES;

            if (withinBounds) {
              const result = await service.create('host-123', dto as never);
              expect(result).toHaveProperty('id');
            } else {
              await expect(
                service.create('host-123', dto as never),
              ).rejects.toThrow(BadRequestException);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-publishing, Property 3: Scheduled Time Validation
  describe('Property 16.3: Scheduled Time Validation', () => {
    /**
     * Validates: Requirements 1.6
     *
     * Generate random timestamps around now() +/- lead time.
     * Assert: only timestamps > now + MIN_LEAD_MINUTES pass validation.
     */
    it('only future timestamps with sufficient lead time pass', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -120, max: 240 }),
          async (offsetMinutes: number) => {
            const scheduledAt = new Date(Date.now() + offsetMinutes * 60 * 1000);
            const dto = buildValidDto({ scheduledAt });

            // The validation checks scheduledAt > now + MIN_LEAD_MINUTES
            const minAllowedTime = new Date(
              Date.now() + OFFER_MIN_LEAD_MINUTES * 60 * 1000,
            );
            const shouldPass = scheduledAt.getTime() > minAllowedTime.getTime();

            if (shouldPass) {
              const result = await service.create('host-123', dto as never);
              expect(result).toHaveProperty('id');
            } else {
              await expect(
                service.create('host-123', dto as never),
              ).rejects.toThrow(BadRequestException);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-publishing, Property 4: Idempotency Round Trip
  describe('Property 16.4: Idempotency Round Trip', () => {
    /**
     * Validates: Requirements 1.8
     *
     * Generate random valid payloads + random UUID keys.
     * Assert: two calls with same (hostId, idempotencyKey) return same offer ID.
     */
    it('same hostId + idempotencyKey returns existing offer ID', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.uuid(),
          async (hostId: string, idempotencyKey: string) => {
            const existingOfferId = `existing-offer-${idempotencyKey}`;

            // Mock repository to return existing offer for this key
            mockRepository.findByIdempotencyKey.mockResolvedValue({
              id: existingOfferId,
            });

            const dto = buildValidDto({ idempotencyKey });

            const firstResult = await service.create(hostId, dto as never);
            const secondResult = await service.create(hostId, dto as never);

            expect(firstResult.id).toBe(existingOfferId);
            expect(secondResult.id).toBe(existingOfferId);
            expect(firstResult.id).toBe(secondResult.id);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-publishing, Property 5: Duplicate Active Offer Prevention
  describe('Property 16.5: Duplicate Active Offer Prevention', () => {
    /**
     * Validates: Requirements 2.1, 2.3
     *
     * Generate random OfferState values for "existing offers."
     * Assert: creation fails when property has offer in DRAFT/PUBLISHED/ACTIVE.
     * Assert: creation succeeds when property's offers are in COMPLETED/CANCELLED/EXPIRED.
     */
    it('blocks creation for active offers, allows for terminal states', async () => {
      const allStates = Object.values(OfferState);

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...allStates),
          async (existingOfferState: OfferState) => {
            const activeStates = [OfferState.DRAFT, OfferState.PUBLISHED, OfferState.ACTIVE];
            const isActiveState = activeStates.includes(existingOfferState);

            if (isActiveState) {
              mockPropertyReadiness.check.mockResolvedValue({
                ready: false,
                reasons: ['HAS_ACTIVE_OFFER'],
              });
            } else {
              mockPropertyReadiness.check.mockResolvedValue({
                ready: true,
                reasons: [],
              });
            }

            // Reset repository mock for non-idempotent calls
            mockRepository.findByIdempotencyKey.mockResolvedValue(null);
            mockRepository.create.mockResolvedValue({ id: 'new-offer-id' });

            const dto = buildValidDto();

            if (isActiveState) {
              await expect(
                service.create('host-123', dto as never),
              ).rejects.toThrow(UnprocessableEntityException);
            } else {
              const result = await service.create('host-123', dto as never);
              expect(result).toHaveProperty('id');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-publishing, Property 6: Required Fields Validation
  describe('Property 16.6: Required Fields Validation', () => {
    /**
     * Validates: Requirements 1.4
     *
     * Generate payloads with random missing fields.
     * Assert: creation is rejected when any required field is missing.
     */
    it('rejects creation when any required field is missing', async () => {
      const requiredFieldKeys = [
        'propertyId',
        'serviceType',
        'offeredPriceCents',
        'scheduledAt',
        'timezone',
        'estimatedDurationMinutes',
        'currency',
      ];

      await fc.assert(
        fc.asyncProperty(
          fc.subarray(requiredFieldKeys, { minLength: 1 }),
          async (fieldsToRemove: string[]) => {
            const dto = buildValidDto();

            // Remove selected fields by setting them to undefined
            for (const field of fieldsToRemove) {
              (dto as Record<string, unknown>)[field] = undefined;
            }

            await expect(
              service.create('host-123', dto as never),
            ).rejects.toThrow(BadRequestException);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
