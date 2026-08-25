import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  UnprocessableEntityException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { OffersRepository } from './offers.repository';
import { CommissionService } from './commission/commission.service';
import { OfferEventEmitterService } from './events/offer-event-emitter.service';
import { OfferStateMachineService } from './state-machine/offer-state-machine';
import { CentrifugoClient } from './delivery/centrifugo.client';
import {
  PROPERTY_READINESS,
  PropertyReadinessInterface,
} from './contracts/property-readiness.interface';
import { OfferState, ServiceType, OfferQueryFilters, PaginatedResponse } from './offers.types';
import { Offer } from './entities/offer.entity';
import {
  OFFER_MIN_LEAD_MINUTES,
  OFFER_MIN_DURATION_MINUTES,
  OFFER_MAX_DURATION_MINUTES,
  OFFER_INITIAL_RADIUS_M,
  OFFER_LIST_DEFAULT_PAGE_SIZE,
  OFFER_EXPANSION_INTERVAL_MS,
  QUEUE_NAMES,
} from './offers.constants';

/** Input shape for publishing an offer */
interface PublishOfferInput {
  favoritesFirst?: boolean;
}

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
    private readonly stateMachine: OfferStateMachineService,
    private readonly dataSource: DataSource,
    private readonly centrifugoClient: CentrifugoClient,
    @Inject(PROPERTY_READINESS)
    private readonly propertyReadiness: PropertyReadinessInterface,
    @InjectQueue(QUEUE_NAMES.RADIUS_EXPANSION)
    private readonly radiusExpansionQueue: Queue,
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

    const scheduledAt = this.parseAndValidateScheduledAt(dto.scheduledAt);

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
   * Snapshots property data, transitions state, enqueues radius expansion jobs.
   */
  async publish(offerId: string, hostId: string, input?: PublishOfferInput): Promise<void> {
    const offer = await this.findAndValidateForPublish(offerId, hostId);

    const snapshot = await this.snapshotPropertyData(offer.propertyId);

    await this.persistPublishFields(offerId, snapshot, input?.favoritesFirst ?? false);

    const transitioned = await this.stateMachine.transitionState(
      offerId,
      OfferState.DRAFT,
      OfferState.PUBLISHED,
      'host',
    );

    if (!transitioned) {
      throw new ConflictException(
        'Offer state changed concurrently — publish failed. Please retry.',
      );
    }

    await this.enqueueRadiusExpansionJobs(offerId);

    this.eventEmitter.emitPublished({
      offerId,
      hostId,
      propertyId: offer.propertyId,
    });

    this.logger.debug(`Published offer ${offerId} for host ${hostId}`);
  }

  /** Validate offer exists, belongs to host, and is in DRAFT state. */
  private async findAndValidateForPublish(offerId: string, hostId: string): Promise<Offer> {
    const offer = await this.offersRepository.findById(offerId);

    if (!offer) {
      throw new NotFoundException(`Offer ${offerId} not found`);
    }

    if (offer.hostId !== hostId) {
      throw new ForbiddenException('You do not own this offer');
    }

    if (offer.state !== OfferState.DRAFT) {
      throw new UnprocessableEntityException(
        `Offer must be in DRAFT state to publish (current: ${offer.state})`,
      );
    }

    return offer;
  }

  /** Query property name, type, city, and cover photo for the snapshot. */
  private async snapshotPropertyData(propertyId: string): Promise<PropertySnapshot> {
    const rows = await this.dataSource.query<PropertySnapshotRow[]>(
      `SELECT p.name, p.type, p.address_city
       FROM properties p
       WHERE p.id = $1`,
      [propertyId],
    );

    const property = rows[0];

    const photoRows = await this.dataSource.query<{ storage_key: string }[]>(
      `SELECT storage_key
       FROM property_photos
       WHERE property_id = $1
       ORDER BY display_order ASC
       LIMIT 1`,
      [propertyId],
    );

    return {
      propertyNameSnapshot: property?.name ?? null,
      propertyTypeSnapshot: property?.type ?? null,
      propertyCitySnapshot: property?.address_city ?? null,
      propertyCoverPhotoSnapshot: photoRows[0]?.storage_key ?? null,
    };
  }

  /** Persist snapshot fields, published_at, and favoritesFirst on the offer record. */
  private async persistPublishFields(
    offerId: string,
    snapshot: PropertySnapshot,
    favoritesFirst: boolean,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE offers
       SET property_name_snapshot = $1,
           property_type_snapshot = $2,
           property_city_snapshot = $3,
           property_cover_photo_snapshot = $4,
           favorites_first = $5,
           published_at = NOW()
       WHERE id = $6`,
      [
        snapshot.propertyNameSnapshot,
        snapshot.propertyTypeSnapshot,
        snapshot.propertyCitySnapshot,
        snapshot.propertyCoverPhotoSnapshot,
        favoritesFirst,
        offerId,
      ],
    );
  }

  /** Enqueue the initial delivery job (delay:0) and first expansion job. */
  private async enqueueRadiusExpansionJobs(offerId: string): Promise<void> {
    await this.radiusExpansionQueue.add(
      'expand-radius',
      { offerId, expectedState: OfferState.PUBLISHED, expectedStep: 0 },
      { delay: 0 },
    );

    await this.radiusExpansionQueue.add(
      'expand-radius',
      { offerId, expectedState: OfferState.PUBLISHED, expectedStep: 1 },
      { delay: OFFER_EXPANSION_INTERVAL_MS },
    );
  }

  /**
   * Cancel an offer (DRAFT/PUBLISHED/ACTIVE → CANCELLED).
   * Cancels pending BullMQ jobs and notifies delivered Cleaners if was ACTIVE.
   */
  async cancel(offerId: string, hostId: string): Promise<void> {
    const offer = await this.findAndValidateForCancel(offerId, hostId);
    const previousState = offer.state as OfferState;

    const transitioned = await this.stateMachine.transitionState(
      offerId,
      previousState,
      OfferState.CANCELLED,
      'host',
    );

    if (!transitioned) {
      throw new ConflictException(
        'Offer state changed concurrently — cancellation failed. Please retry.',
      );
    }

    await this.setCancelledTimestamp(offerId);

    if (previousState === OfferState.PUBLISHED || previousState === OfferState.ACTIVE) {
      await this.cancelPendingJobs(offerId);
    }

    if (previousState === OfferState.ACTIVE) {
      await this.notifyDeliveredCleaners(offerId);
    }

    this.eventEmitter.emitCancelled({ offerId, hostId, previousState });

    this.logger.debug(`Cancelled offer ${offerId} (was ${previousState}) by host ${hostId}`);
  }

  /** Validate offer exists, belongs to host, and is in a cancellable state. */
  private async findAndValidateForCancel(offerId: string, hostId: string): Promise<Offer> {
    const offer = await this.offersRepository.findById(offerId);

    if (!offer) {
      throw new NotFoundException(`Offer ${offerId} not found`);
    }

    if (offer.hostId !== hostId) {
      throw new ForbiddenException('You do not own this offer');
    }

    const cancellableStates: OfferState[] = [
      OfferState.DRAFT,
      OfferState.PUBLISHED,
      OfferState.ACTIVE,
    ];

    if (!cancellableStates.includes(offer.state as OfferState)) {
      throw new UnprocessableEntityException(
        `Cannot cancel offer in ${offer.state} state. Only DRAFT, PUBLISHED, or ACTIVE offers can be cancelled.`,
      );
    }

    return offer;
  }

  /** Set cancelled_at timestamp on the offer record. */
  private async setCancelledTimestamp(offerId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE offers SET cancelled_at = NOW() WHERE id = $1`,
      [offerId],
    );
  }

  /** Cancel all pending BullMQ jobs for this offer from the radius expansion queue. */
  private async cancelPendingJobs(offerId: string): Promise<void> {
    const [delayedJobs, waitingJobs] = await Promise.all([
      this.radiusExpansionQueue.getDelayed(),
      this.radiusExpansionQueue.getWaiting(),
    ]);

    const allJobs = [...delayedJobs, ...waitingJobs];
    const offerJobs = allJobs.filter(
      (job) => job.data?.offerId === offerId,
    );

    await Promise.all(offerJobs.map((job) => job.remove()));

    if (offerJobs.length > 0) {
      this.logger.debug(
        `Removed ${offerJobs.length} pending job(s) for offer ${offerId}`,
      );
    }
  }

  /** Notify delivered Cleaners about the cancellation via Centrifugo broadcast. */
  private async notifyDeliveredCleaners(offerId: string): Promise<void> {
    const cleanerIds = await this.offersRepository.findDeliveredCleanerIds(offerId);

    if (cleanerIds.length === 0) {
      return;
    }

    const channels = cleanerIds.map((id) => `offers:cleaner:${id}`);

    await this.centrifugoClient.broadcast(channels, {
      type: 'offer_cancelled',
      offerId,
    });

    this.logger.debug(
      `Broadcast cancellation for offer ${offerId} to ${cleanerIds.length} cleaner(s)`,
    );
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

  /** Parse scheduledAt and validate it is far enough in the future. Returns the parsed Date. */
  private parseAndValidateScheduledAt(scheduledAt: Date | string): Date {
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

    return scheduledDate;
  }
}

/** Raw row shape from property snapshot query */
interface PropertySnapshotRow {
  readonly name: string | null;
  readonly type: string | null;
  readonly address_city: string | null;
}

/** Typed property snapshot fields for the offer record */
interface PropertySnapshot {
  readonly propertyNameSnapshot: string | null;
  readonly propertyTypeSnapshot: string | null;
  readonly propertyCitySnapshot: string | null;
  readonly propertyCoverPhotoSnapshot: string | null;
}
