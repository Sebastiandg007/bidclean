import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OffersRepository } from './offers.repository';
import { CommissionService } from './commission/commission.service';
import { OfferEventEmitterService } from './events/offer-event-emitter.service';
import {
  PROPERTY_READINESS,
  PropertyReadinessInterface,
} from './contracts/property-readiness.interface';
import { OfferState, ServiceType, OfferQueryFilters, PaginatedResponse } from './offers.types';
import {
  OFFER_MIN_LEAD_MINUTES,
  OFFER_MIN_DURATION_MINUTES,
  OFFER_MAX_DURATION_MINUTES,
  OFFER_INITIAL_RADIUS_M,
  OFFER_LIST_DEFAULT_PAGE_SIZE,
} from './offers.constants';

/** Input shape for creating an offer */
interface CreateOfferInput {
  propertyId: string;
  serviceType: string;
  offeredPriceCents: number;
  scheduledAt: Date | string;
  timezone: string;
  estimatedDurationMinutes: number;
  currency: string;
  description?: string;
  idempotencyKey?: string;
}

/**
 * Core offers service.
 *
 * Orchestrates the full offer lifecycle:
 * - Create: validates inputs, calculates commission, persists DRAFT
 * - Publish: snapshots property data, transitions to PUBLISHED, enqueues delivery
 * - Cancel: transitions to CANCELLED, cancels jobs, notifies Cleaners
 * - Query: paginated listing with state filtering, detail with history
 *
 * Delegates state transitions to the offer state machine with optimistic locking.
 * Emits domain events on every state transition for downstream consumers.
 */
@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly commissionService: CommissionService,
    private readonly eventEmitter: OfferEventEmitterService,
    @Inject(PROPERTY_READINESS)
    private readonly propertyReadiness: PropertyReadinessInterface,
  ) {}

  /**
   * Create a new offer in DRAFT state.
   * Validates property readiness, pricing, scheduling, and duplicates.
   */
  async create(hostId: string, dto: CreateOfferInput): Promise<{ id: string }> {
    this.validateRequiredFields(dto);
    this.validateServiceType(dto.serviceType);
    this.validatePricePositive(dto.offeredPriceCents);
    this.validateDurationBounds(dto.estimatedDurationMinutes);
    this.validateScheduledAt(dto.scheduledAt);

    const readinessResult = await this.propertyReadiness.check(dto.propertyId, hostId);
    if (!readinessResult.ready) {
      throw new UnprocessableEntityException({
        message: 'Property is not ready for offer creation',
        reasons: readinessResult.reasons,
      });
    }

    if (dto.idempotencyKey) {
      const existing = await this.offersRepository.findByIdempotencyKey(
        hostId,
        dto.idempotencyKey,
      );
      if (existing) {
        return { id: existing.id };
      }
    }

    const breakdown = this.commissionService.getFullBreakdown(dto.offeredPriceCents);

    const scheduledAt =
      typeof dto.scheduledAt === 'string' ? new Date(dto.scheduledAt) : dto.scheduledAt;

    const offer = await this.offersRepository.create({
      hostId,
      propertyId: dto.propertyId,
      serviceType: dto.serviceType,
      description: dto.description ?? null,
      scheduledAt,
      timezone: dto.timezone,
      estimatedDurationMinutes: dto.estimatedDurationMinutes,
      offeredPriceCents: dto.offeredPriceCents,
      currency: dto.currency,
      hostServiceFeeCents: breakdown.hostFeeCents,
      hostTotalCents: breakdown.hostTotalCents,
      cleanerCommissionCents: breakdown.cleanerCommissionCents,
      cleanerPayoutCents: breakdown.cleanerPayoutCents,
      hostServiceFeeRateBps: breakdown.hostFeeRateBps,
      cleanerCommissionRateBps: breakdown.cleanerRateBps,
      state: OfferState.DRAFT,
      currentRadiusMeters: OFFER_INITIAL_RADIUS_M,
      idempotencyKey: dto.idempotencyKey ?? null,
    });

    await this.offersRepository.insertStateTransition({
      offerId: offer.id,
      fromState: null,
      toState: OfferState.DRAFT,
      triggeredBy: 'host',
    });

    this.eventEmitter.emitCreated({
      offerId: offer.id,
      hostId,
      propertyId: dto.propertyId,
    });

    this.logger.debug(`Created offer ${offer.id} for host ${hostId}`);

    return { id: offer.id };
  }

  /**
   * Publish an offer (DRAFT → PUBLISHED).
   * Snapshots property data and enqueues radius expansion.
   */
  async publish(_offerId: string, _hostId: string): Promise<void> {
    // TODO(offer-publishing/Task-17): implement publish offer flow
    this.logger.debug('publish() stub called');
  }

  /**
   * Cancel an offer (DRAFT/PUBLISHED/ACTIVE → CANCELLED).
   * Cancels pending jobs and notifies delivered Cleaners.
   */
  async cancel(_offerId: string, _hostId: string): Promise<void> {
    // TODO(offer-publishing/Task-18): implement cancel offer flow
    this.logger.debug('cancel() stub called');
  }

  /**
   * Find a single offer by ID with state transition history.
   */
  async findById(_offerId: string, _hostId: string): Promise<Record<string, unknown> | null> {
    // TODO(offer-publishing/Task-14): implement findById
    return null;
  }

  /**
   * Find all offers for a Host with pagination and state filtering.
   */
  async findByHostId(
    _hostId: string,
    _filters: OfferQueryFilters,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    // TODO(offer-publishing/Task-14): implement findByHostId
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: OFFER_LIST_DEFAULT_PAGE_SIZE,
      totalPages: 0,
    };
  }

  /** Validate that all required fields are present in the DTO */
  private validateRequiredFields(dto: CreateOfferInput): void {
    const requiredFields: (keyof CreateOfferInput)[] = [
      'propertyId',
      'serviceType',
      'offeredPriceCents',
      'scheduledAt',
      'timezone',
      'estimatedDurationMinutes',
      'currency',
    ];

    const missingFields = requiredFields.filter(
      (field) => dto[field] === undefined || dto[field] === null,
    );

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Missing required fields: ${missingFields.join(', ')}`,
      );
    }
  }

  /** Validate that serviceType is a valid ServiceType enum value */
  private validateServiceType(serviceType: string): void {
    const validTypes = Object.values(ServiceType) as string[];
    if (!validTypes.includes(serviceType)) {
      throw new BadRequestException(
        `Invalid service type: ${serviceType}. Valid types: ${validTypes.join(', ')}`,
      );
    }
  }

  /** Validate that offeredPriceCents is a positive integer */
  private validatePricePositive(priceCents: number): void {
    if (!Number.isInteger(priceCents) || priceCents <= 0) {
      throw new BadRequestException(
        'offeredPriceCents must be a positive integer',
      );
    }
  }

  /** Validate that estimatedDurationMinutes is within configured bounds */
  private validateDurationBounds(durationMinutes: number): void {
    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes < OFFER_MIN_DURATION_MINUTES ||
      durationMinutes > OFFER_MAX_DURATION_MINUTES
    ) {
      throw new BadRequestException(
        `estimatedDurationMinutes must be between ${OFFER_MIN_DURATION_MINUTES} and ${OFFER_MAX_DURATION_MINUTES}`,
      );
    }
  }

  /** Validate that scheduledAt is far enough in the future */
  private validateScheduledAt(scheduledAt: Date | string): void {
    const scheduledDate =
      typeof scheduledAt === 'string' ? new Date(scheduledAt) : scheduledAt;

    const minAllowedTime = new Date(
      Date.now() + OFFER_MIN_LEAD_MINUTES * 60 * 1000,
    );

    if (scheduledDate <= minAllowedTime) {
      throw new BadRequestException(
        `scheduledAt must be at least ${OFFER_MIN_LEAD_MINUTES} minutes in the future`,
      );
    }
  }
}
