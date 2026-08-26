import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { CentrifugoClient } from './centrifugo.client';
import { OfferNotificationService } from '../notification/offer-notification.service';
import { OffersRepository } from '../offers.repository';
import { OfferStateMachineService } from '../state-machine/offer-state-machine';
import { OfferEventEmitterService } from '../events/offer-event-emitter.service';
import {
  DeliveryTier,
  DeliveryStatus,
  DeliveryChannel,
  OfferState,
} from '../offers.types';
import {
  OFFER_FAVORITES_WINDOW_MS,
  OFFER_PRO_FREE_DELAY_MS,
  QUEUE_NAMES,
} from '../offers.constants';
import { DiscoveredCleaner } from '../discovery/cleaner-discovery.types';
import { DeliveryAttemptResult } from './delivery.types';

/** Payload for a tier delivery BullMQ job */
interface TierDeliveryJobData {
  readonly offerId: string;
  readonly tier: DeliveryTier;
  readonly cleanerIds: string[];
  readonly radiusStep: number;
}

/**
 * Delivery scheduler service.
 *
 * Orchestrates tiered offer delivery to Cleaners:
 * 1. Favorites first (if enabled) — immediate delivery
 * 2. PRO Cleaners — after favorites window expires
 * 3. FREE Cleaners — after PRO delay
 *
 * Creates delivery records (PENDING), attempts WebSocket via Centrifugo,
 * falls back to push via OneSignal, and updates delivery status.
 * Triggers PUBLISHED → ACTIVE on first successful delivery.
 */
@Injectable()
export class DeliverySchedulerService {
  private readonly logger = new Logger(DeliverySchedulerService.name);

  /** Tracks whether PUBLISHED→ACTIVE transition has been triggered per offer (in-memory guard) */
  private readonly activatedOffers = new Set<string>();

  constructor(
    private readonly centrifugoClient: CentrifugoClient,
    private readonly offerNotificationService: OfferNotificationService,
    private readonly offersRepository: OffersRepository,
    private readonly stateMachine: OfferStateMachineService,
    private readonly eventEmitter: OfferEventEmitterService,
    @InjectQueue(QUEUE_NAMES.TIER_DELIVERY)
    private readonly tierDeliveryQueue: Queue,
  ) {}

  /**
   * Deliver an offer to a batch of discovered Cleaners, partitioned by tier.
   *
   * Orchestration logic:
   * - If favoritesFirst AND there are favorites → deliver to favorites immediately,
   *   schedule PRO delivery after FAVORITES_WINDOW_MS
   * - If favoritesFirst but no favorites, OR not favoritesFirst → deliver to PRO immediately,
   *   schedule FREE delivery after PRO_FREE_DELAY_MS
   *
   * @param offerId - The offer being delivered
   * @param cleaners - Discovered Cleaners with tier classification
   * @param radiusStep - Current radius expansion step (for stale-job detection)
   */
  async deliverToCleaners(
    offerId: string,
    cleaners: DiscoveredCleaner[],
    radiusStep: number,
  ): Promise<void> {
    if (cleaners.length === 0) {
      this.logger.debug(`No cleaners to deliver offer ${offerId} at step ${radiusStep}`);
      return;
    }

    const offer = await this.offersRepository.findById(offerId);
    if (!offer) {
      this.logger.warn(`Offer ${offerId} not found, skipping delivery`);
      return;
    }

    const { favorites, pros, frees } = this.partitionByTier(cleaners);

    if (offer.favoritesFirst && favorites.length > 0) {
      await this.deliverToFavoritesFirst(offerId, favorites, pros, frees, radiusStep);
    } else {
      await this.deliverProThenFree(offerId, pros, frees, radiusStep);
    }
  }

  /**
   * Process a delayed tier delivery job from the BullMQ queue.
   *
   * Validates that the offer is still eligible for delivery (stale-job guard)
   * before delivering to each Cleaner in the batch.
   *
   * @param jobData - Job payload with offerId, tier, cleanerIds, and radiusStep
   */
  async processTierDeliveryJob(jobData: TierDeliveryJobData): Promise<void> {
    const { offerId, tier, cleanerIds, radiusStep } = jobData;

    if (!await this.isOfferEligibleForDelivery(offerId)) {
      this.logger.debug(
        `Stale tier delivery job for offer ${offerId}, tier ${tier} — skipping`,
      );
      return;
    }

    this.logger.log(
      `Processing tier delivery: offer=${offerId}, tier=${tier}, cleaners=${cleanerIds.length}`,
    );

    for (const cleanerId of cleanerIds) {
      await this.deliverToSingleCleaner(offerId, cleanerId, tier, radiusStep);
    }
  }

  /**
   * Schedule a delayed delivery for a specific tier via BullMQ.
   *
   * @param offerId - The offer to deliver
   * @param tier - Target tier (PRO or FREE)
   * @param cleanerIds - Cleaner IDs to deliver to
   * @param radiusStep - Current radius step
   * @param delayMs - Delay in milliseconds before processing
   */
  async scheduleTierDelivery(
    offerId: string,
    tier: DeliveryTier,
    cleanerIds: string[],
    radiusStep: number,
    delayMs: number,
  ): Promise<void> {
    if (cleanerIds.length === 0) {
      return;
    }

    const jobData: TierDeliveryJobData = { offerId, tier, cleanerIds, radiusStep };

    await this.tierDeliveryQueue.add(
      `deliver-${tier.toLowerCase()}-${offerId}`,
      jobData,
      { delay: delayMs },
    );

    this.logger.debug(
      `Scheduled ${tier} delivery for offer ${offerId}: ${cleanerIds.length} cleaners, delay=${delayMs}ms`,
    );
  }

  /**
   * Deliver to a single Cleaner: create PENDING record, attempt WebSocket, fallback to push.
   *
   * @param offerId - The offer being delivered
   * @param cleanerId - Target Cleaner
   * @param tier - Cleaner's delivery tier
   * @param radiusStep - Current radius expansion step
   * @returns Delivery attempt result
   */
  async deliverToSingleCleaner(
    offerId: string,
    cleanerId: string,
    tier: DeliveryTier,
    radiusStep: number,
  ): Promise<DeliveryAttemptResult> {
    const delivery = await this.createPendingDelivery(offerId, cleanerId, tier, radiusStep);
    if (!delivery) {
      return this.buildFailedResult(cleanerId, 'Failed to create delivery record');
    }

    const result = await this.attemptDelivery(offerId, cleanerId, delivery.id);
    await this.handleDeliveryResult(offerId, result);

    return result;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private: Orchestration
  // ────────────────────────────────────────────────────────────────────────────

  /** Deliver to favorites immediately, schedule PRO + FREE for later. */
  private async deliverToFavoritesFirst(
    offerId: string,
    favorites: DiscoveredCleaner[],
    pros: DiscoveredCleaner[],
    frees: DiscoveredCleaner[],
    radiusStep: number,
  ): Promise<void> {
    this.logger.log(
      `Delivering offer ${offerId} to ${favorites.length} favorites first`,
    );

    // Deliver to favorites immediately
    for (const cleaner of favorites) {
      await this.deliverToSingleCleaner(offerId, cleaner.cleanerId, DeliveryTier.FAVORITE, radiusStep);
    }

    // Schedule PRO delivery after favorites window
    const proIds = pros.map((c) => c.cleanerId);
    await this.scheduleTierDelivery(
      offerId,
      DeliveryTier.PRO,
      proIds,
      radiusStep,
      OFFER_FAVORITES_WINDOW_MS,
    );

    // Schedule FREE delivery after favorites window + PRO delay
    const freeIds = frees.map((c) => c.cleanerId);
    await this.scheduleTierDelivery(
      offerId,
      DeliveryTier.FREE,
      freeIds,
      radiusStep,
      OFFER_FAVORITES_WINDOW_MS + OFFER_PRO_FREE_DELAY_MS,
    );
  }

  /** Deliver to PRO immediately, schedule FREE for later. */
  private async deliverProThenFree(
    offerId: string,
    pros: DiscoveredCleaner[],
    frees: DiscoveredCleaner[],
    radiusStep: number,
  ): Promise<void> {
    this.logger.log(
      `Delivering offer ${offerId} to ${pros.length} PRO cleaners immediately`,
    );

    // Deliver to PRO immediately
    for (const cleaner of pros) {
      await this.deliverToSingleCleaner(offerId, cleaner.cleanerId, DeliveryTier.PRO, radiusStep);
    }

    // Schedule FREE delivery after PRO→FREE delay
    const freeIds = frees.map((c) => c.cleanerId);
    await this.scheduleTierDelivery(
      offerId,
      DeliveryTier.FREE,
      freeIds,
      radiusStep,
      OFFER_PRO_FREE_DELAY_MS,
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private: Delivery execution
  // ────────────────────────────────────────────────────────────────────────────

  /** Create a PENDING delivery record. Returns null on duplicate constraint violation. */
  private async createPendingDelivery(
    offerId: string,
    cleanerId: string,
    tier: DeliveryTier,
    radiusStep: number,
  ): Promise<{ id: string } | null> {
    try {
      const delivery = await this.offersRepository.insertDelivery({
        offerId,
        cleanerId,
        tier,
        radiusStep,
      });
      return { id: delivery.id };
    } catch (error) {
      this.logger.warn(
        `Failed to create delivery record for offer=${offerId}, cleaner=${cleanerId}: ${String(error)}`,
      );
      return null;
    }
  }

  /** Attempt WebSocket delivery, fallback to push if WebSocket fails. */
  private async attemptDelivery(
    offerId: string,
    cleanerId: string,
    deliveryId: string,
  ): Promise<DeliveryAttemptResult> {
    // Attempt WebSocket via Centrifugo
    const wsSuccess = await this.attemptWebSocket(offerId, cleanerId);
    if (wsSuccess) {
      await this.markDeliverySent(deliveryId, DeliveryChannel.WEBSOCKET);
      return this.buildSentResult(cleanerId, DeliveryChannel.WEBSOCKET);
    }

    // Fallback to push notification
    const pushSuccess = await this.attemptPush(offerId, cleanerId);
    if (pushSuccess) {
      await this.markDeliverySent(deliveryId, DeliveryChannel.PUSH);
      return this.buildSentResult(cleanerId, DeliveryChannel.PUSH);
    }

    // Both channels failed
    const failureReason = 'WebSocket and push delivery both failed';
    await this.markDeliveryFailed(deliveryId, failureReason);
    return this.buildFailedResult(cleanerId, failureReason);
  }

  /** Attempt WebSocket delivery via Centrifugo. */
  private async attemptWebSocket(offerId: string, cleanerId: string): Promise<boolean> {
    const channel = this.buildChannelName(cleanerId);
    const payload = this.buildWebSocketPayload(offerId);

    try {
      return await this.centrifugoClient.publish(channel, payload);
    } catch (error) {
      this.logger.warn(
        `WebSocket delivery failed for offer=${offerId}, cleaner=${cleanerId}: ${String(error)}`,
      );
      return false;
    }
  }

  /** Attempt push notification delivery. */
  private async attemptPush(offerId: string, cleanerId: string): Promise<boolean> {
    try {
      return await this.offerNotificationService.sendOfferNotification(cleanerId, offerId);
    } catch (error) {
      this.logger.warn(
        `Push delivery failed for offer=${offerId}, cleaner=${cleanerId}: ${String(error)}`,
      );
      return false;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private: Status updates
  // ────────────────────────────────────────────────────────────────────────────

  /** Mark a delivery record as SENT with the channel used. */
  private async markDeliverySent(deliveryId: string, channel: DeliveryChannel): Promise<void> {
    await this.offersRepository.updateDeliveryStatus({
      deliveryId,
      status: DeliveryStatus.SENT,
      channel,
    });
  }

  /** Mark a delivery record as FAILED with the reason. */
  private async markDeliveryFailed(deliveryId: string, failureReason: string): Promise<void> {
    await this.offersRepository.updateDeliveryStatus({
      deliveryId,
      status: DeliveryStatus.FAILED,
      failureReason,
    });
  }

  /** Handle delivery result: trigger PUBLISHED→ACTIVE on first SENT delivery. */
  private async handleDeliveryResult(
    offerId: string,
    result: DeliveryAttemptResult,
  ): Promise<void> {
    if (result.status !== DeliveryStatus.SENT) {
      return;
    }

    await this.triggerActivationIfFirst(offerId);
  }

  /**
   * Trigger PUBLISHED → ACTIVE transition on the first successful delivery.
   * Uses an in-memory set to prevent duplicate attempts (even with concurrency).
   * The state machine's optimistic locking provides the ultimate safety net.
   */
  private async triggerActivationIfFirst(offerId: string): Promise<void> {
    if (this.activatedOffers.has(offerId)) {
      return;
    }

    this.activatedOffers.add(offerId);

    const transitioned = await this.stateMachine.transitionState(
      offerId,
      OfferState.PUBLISHED,
      OfferState.ACTIVE,
      'delivery_scheduler',
    );

    if (!transitioned) {
      // Already ACTIVE or in another state — this is expected for subsequent deliveries
      return;
    }

    const offer = await this.offersRepository.findById(offerId);
    if (offer) {
      this.eventEmitter.emitActivated({ offerId, hostId: offer.hostId });
    }

    this.logger.log(`Offer ${offerId} transitioned to ACTIVE on first delivery`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private: Guards and validation
  // ────────────────────────────────────────────────────────────────────────────

  /** Check if an offer is still eligible for delivery (PUBLISHED or ACTIVE). */
  private async isOfferEligibleForDelivery(offerId: string): Promise<boolean> {
    const offer = await this.offersRepository.findById(offerId);
    if (!offer) {
      return false;
    }

    return offer.state === OfferState.PUBLISHED || offer.state === OfferState.ACTIVE;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private: Helpers
  // ────────────────────────────────────────────────────────────────────────────

  /** Partition discovered Cleaners into favorites, PRO, and FREE groups. */
  private partitionByTier(cleaners: DiscoveredCleaner[]): {
    favorites: DiscoveredCleaner[];
    pros: DiscoveredCleaner[];
    frees: DiscoveredCleaner[];
  } {
    const favorites: DiscoveredCleaner[] = [];
    const pros: DiscoveredCleaner[] = [];
    const frees: DiscoveredCleaner[] = [];

    for (const cleaner of cleaners) {
      switch (cleaner.tier) {
        case DeliveryTier.FAVORITE:
          favorites.push(cleaner);
          break;
        case DeliveryTier.PRO:
          pros.push(cleaner);
          break;
        case DeliveryTier.FREE:
          frees.push(cleaner);
          break;
      }
    }

    return { favorites, pros, frees };
  }

  /** Build the Centrifugo channel name for a Cleaner. */
  private buildChannelName(cleanerId: string): string {
    return `offers:cleaner:${cleanerId}`;
  }

  /** Build the WebSocket payload for a new offer delivery. */
  private buildWebSocketPayload(offerId: string): { type: string; offerId: string } {
    return {
      type: 'offer_new',
      offerId,
    };
  }

  /** Build a SENT delivery attempt result. */
  private buildSentResult(cleanerId: string, channel: DeliveryChannel): DeliveryAttemptResult {
    return {
      cleanerId,
      status: DeliveryStatus.SENT,
      channel,
      failureReason: null,
    };
  }

  /** Build a FAILED delivery attempt result. */
  private buildFailedResult(cleanerId: string, failureReason: string): DeliveryAttemptResult {
    return {
      cleanerId,
      status: DeliveryStatus.FAILED,
      channel: null,
      failureReason,
    };
  }
}
