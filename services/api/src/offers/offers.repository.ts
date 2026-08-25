import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Offer } from './entities/offer.entity';
import { OfferStateTransition } from './entities/offer-state-transition.entity';
import { OfferDelivery } from './entities/offer-delivery.entity';
import {
  OfferState,
  DeliveryStatus,
  PaginatedResponse,
  OfferQueryFilters,
} from './offers.types';
import {
  OFFER_LIST_DEFAULT_PAGE_SIZE,
  OFFER_LIST_MAX_PAGE_SIZE,
} from './offers.constants';

/** Data required to insert a new delivery record */
interface InsertDeliveryData {
  readonly offerId: string;
  readonly cleanerId: string;
  readonly tier: string;
  readonly radiusStep: number;
}

/** Data required to insert a state transition audit record */
interface InsertStateTransitionData {
  readonly offerId: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly triggeredBy: string;
  readonly metadata?: Record<string, unknown> | null;
}

/** Data required to update a delivery status */
interface UpdateDeliveryStatusData {
  readonly deliveryId: string;
  readonly status: DeliveryStatus;
  readonly channel?: string | null;
  readonly failureReason?: string | null;
}

/**
 * Offers repository.
 *
 * Handles all database operations for offers, state transitions, and deliveries.
 * Uses optimistic locking (WHERE state = :expectedState) for concurrent safety.
 * All ownership-scoped queries enforce host_id filtering.
 */
@Injectable()
export class OffersRepository {
  private readonly logger = new Logger(OffersRepository.name);

  constructor(
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(OfferStateTransition)
    private readonly transitionRepo: Repository<OfferStateTransition>,
    @InjectRepository(OfferDelivery)
    private readonly deliveryRepo: Repository<OfferDelivery>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Persist a new offer record.
   * @param data - Partial offer data to create
   * @returns The created Offer entity with generated ID and timestamps
   */
  async create(data: Partial<Offer>): Promise<Offer> {
    const offer = this.offerRepo.create(data);
    const saved = await this.offerRepo.save(offer);
    this.logger.debug(`Created offer ${saved.id} for host ${saved.hostId}`);
    return saved;
  }

  /**
   * Find an offer by ID, optionally loading relations.
   * @param offerId - UUID of the offer
   * @param relations - Optional relation names to eager-load (stateTransitions, deliveries)
   * @returns The Offer entity or null if not found
   */
  async findById(
    offerId: string,
    relations?: ('stateTransitions' | 'deliveries')[],
  ): Promise<Offer | null> {
    return this.offerRepo.findOne({
      where: { id: offerId },
      relations: relations ?? [],
    });
  }

  /**
   * Find offers by host ID with pagination, state filter, and sorting.
   * Results are sorted by created_at DESC by default.
   * All queries scoped to host ownership.
   *
   * @param hostId - UUID of the host user
   * @param filters - Optional query filters (state, page, pageSize, sortOrder)
   * @returns Paginated response with offers and metadata
   */
  async findByHostId(
    hostId: string,
    filters?: OfferQueryFilters,
  ): Promise<PaginatedResponse<Offer>> {
    const page = Math.max(1, filters?.page ?? 1);
    const pageSize = this.clampPageSize(filters?.pageSize);
    const offset = (page - 1) * pageSize;
    const sortOrder = filters?.sortOrder ?? 'DESC';

    const qb = this.offerRepo
      .createQueryBuilder('offer')
      .where('offer.hostId = :hostId', { hostId });

    if (filters?.state) {
      qb.andWhere('offer.state = :state', { state: filters.state });
    }

    qb.orderBy('offer.createdAt', sortOrder)
      .skip(offset)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Update offer state with optimistic locking.
   * Only succeeds if the current state matches expectedState (prevents race conditions).
   *
   * @param offerId - UUID of the offer to update
   * @param expectedState - The state the offer must currently be in
   * @param newState - The target state to transition to
   * @returns true if the update succeeded, false if the row was already changed
   */
  async updateState(
    offerId: string,
    expectedState: OfferState,
    newState: OfferState,
  ): Promise<boolean> {
    const result = await this.offerRepo
      .createQueryBuilder()
      .update(Offer)
      .set({ state: newState })
      .where('id = :offerId', { offerId })
      .andWhere('state = :expectedState', { expectedState })
      .execute();

    const affected = result.affected ?? 0;
    if (affected === 0) {
      this.logger.warn(
        `Optimistic lock failed: offer ${offerId} not in state ${expectedState}`,
      );
    }
    return affected > 0;
  }

  /**
   * Update radius expansion tracking fields for an offer.
   *
   * @param offerId - UUID of the offer
   * @param currentRadiusMeters - New current radius value in meters
   * @param expansionStepCount - New expansion step count
   */
  async updateRadiusExpansion(
    offerId: string,
    currentRadiusMeters: number,
    expansionStepCount: number,
  ): Promise<void> {
    await this.offerRepo
      .createQueryBuilder()
      .update(Offer)
      .set({ currentRadiusMeters, expansionStepCount })
      .where('id = :offerId', { offerId })
      .execute();
  }

  /**
   * Insert a state transition audit record into offer_state_transitions.
   * Immutable append-only record of every lifecycle state change.
   *
   * @param data - State transition data (offerId, fromState, toState, triggeredBy, metadata)
   * @returns The created OfferStateTransition entity
   */
  async insertStateTransition(
    data: InsertStateTransitionData,
  ): Promise<OfferStateTransition> {
    const transition = this.transitionRepo.create({
      offerId: data.offerId,
      fromState: data.fromState,
      toState: data.toState,
      triggeredBy: data.triggeredBy,
      metadata: data.metadata ?? null,
    });
    return this.transitionRepo.save(transition);
  }

  /**
   * Insert a delivery record for a Cleaner.
   * Created with PENDING status; updated later when delivery is confirmed or fails.
   *
   * @param data - Delivery data (offerId, cleanerId, tier, radiusStep)
   * @returns The created OfferDelivery entity
   */
  async insertDelivery(data: InsertDeliveryData): Promise<OfferDelivery> {
    const delivery = this.deliveryRepo.create({
      offerId: data.offerId,
      cleanerId: data.cleanerId,
      tier: data.tier,
      radiusStep: data.radiusStep,
    });
    return this.deliveryRepo.save(delivery);
  }

  /**
   * Update delivery status (PENDING → SENT or FAILED).
   * Sets delivered_at = NOW() when status transitions to SENT.
   *
   * @param data - Update data (deliveryId, status, channel, failureReason)
   */
  async updateDeliveryStatus(data: UpdateDeliveryStatusData): Promise<void> {
    const qb = this.deliveryRepo
      .createQueryBuilder()
      .update(OfferDelivery)
      .set(this.buildDeliveryStatusUpdate(data))
      .where('id = :deliveryId', { deliveryId: data.deliveryId });

    await qb.execute();
  }

  /** Build the SET clause fields for a delivery status update. */
  private buildDeliveryStatusUpdate(
    data: UpdateDeliveryStatusData,
  ): {
    deliveryStatus: string;
    deliveredAt?: Date;
    deliveryChannel?: string | null;
    failureReason?: string | null;
  } {
    if (data.status === DeliveryStatus.SENT) {
      return {
        deliveryStatus: data.status,
        deliveredAt: new Date(),
        deliveryChannel: data.channel ?? null,
      };
    }

    if (data.status === DeliveryStatus.FAILED) {
      return {
        deliveryStatus: data.status,
        failureReason: data.failureReason ?? null,
      };
    }

    return { deliveryStatus: data.status };
  }

  /**
   * Find all deliveries for an offer.
   *
   * @param offerId - UUID of the offer
   * @returns Array of OfferDelivery records ordered by creation time
   */
  async findDeliveriesByOffer(offerId: string): Promise<OfferDelivery[]> {
    return this.deliveryRepo.find({
      where: { offerId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Find IDs of Cleaners already delivered to for exclusion during expansion.
   * Excludes null cleaner IDs (deleted users).
   *
   * @param offerId - UUID of the offer
   * @returns Array of cleaner_id strings (never includes nulls)
   */
  async findDeliveredCleanerIds(offerId: string): Promise<string[]> {
    const rows = await this.dataSource.query<{ cleaner_id: string }[]>(
      `SELECT DISTINCT cleaner_id
       FROM offer_deliveries
       WHERE offer_id = $1
         AND cleaner_id IS NOT NULL`,
      [offerId],
    );

    return rows.map((row) => row.cleaner_id);
  }

  /**
   * Find an existing offer by host_id + idempotency_key for duplicate detection.
   * Only matches non-null idempotency keys to avoid false positives.
   *
   * @param hostId - UUID of the host user
   * @param idempotencyKey - Client-generated idempotency key
   * @returns The existing Offer or null if no duplicate found
   */
  async findByIdempotencyKey(
    hostId: string,
    idempotencyKey: string,
  ): Promise<Offer | null> {
    return this.offerRepo.findOne({
      where: {
        hostId,
        idempotencyKey,
      },
    });
  }

  /**
   * Clamp page size within allowed bounds.
   * Ensures value is at least 1 and at most OFFER_LIST_MAX_PAGE_SIZE.
   */
  private clampPageSize(pageSize?: number): number {
    const size = pageSize ?? OFFER_LIST_DEFAULT_PAGE_SIZE;
    return Math.min(Math.max(1, size), OFFER_LIST_MAX_PAGE_SIZE);
  }
}
