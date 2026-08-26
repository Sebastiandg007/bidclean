import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { OffersRepository } from '../offers.repository';
import {
  CleanerDiscoveryInterface,
  CLEANER_DISCOVERY,
} from '../discovery/cleaner-discovery.interface';
import { DeliverySchedulerService } from '../delivery/delivery-scheduler.service';
import { OfferStateMachineService } from '../state-machine/offer-state-machine';
import { OfferEventEmitterService } from '../events/offer-event-emitter.service';
import { OfferState } from '../offers.types';
import {
  OFFER_EXPANSION_STEP_M,
  OFFER_MAX_RADIUS_M,
  OFFER_EXPANSION_INTERVAL_MS,
  OFFER_FINAL_WAIT_MS,
  QUEUE_NAMES,
} from '../offers.constants';
import {
  RadiusExpansionJobPayload,
  ExpansionStepResult,
} from './radius-expansion.types';
import { isStaleJob } from './stale-job.guard';

/**
 * Calculate the expanded radius for a given step.
 *
 * Pure function extracted for property-based testing.
 * Returns min(initialRadius + step * stepSize, maxRadius).
 *
 * @param initialRadius - Starting radius in meters
 * @param step - Current expansion step (0-based)
 * @param stepSize - Meters added per step
 * @param maxRadius - Maximum allowed radius in meters
 * @returns Capped radius value in meters
 */
export function calculateExpandedRadius(
  initialRadius: number,
  step: number,
  stepSize: number,
  maxRadius: number,
): number {
  return Math.min(initialRadius + step * stepSize, maxRadius);
}

/**
 * BullMQ worker for offer radius expansion.
 *
 * Processes delayed jobs from the offer-radius-expansion queue.
 * Each job expands the search radius by one step, discovers new Cleaners,
 * triggers delivery, and schedules the next expansion or final-wait.
 *
 * Stale job guard: validates offer state + expansion step before processing.
 * If validation fails, the job completes silently (idempotent).
 */
@Processor(QUEUE_NAMES.RADIUS_EXPANSION)
export class RadiusExpansionProcessor extends WorkerHost {
  private readonly logger = new Logger(RadiusExpansionProcessor.name);

  constructor(
    private readonly offersRepository: OffersRepository,
    @Inject(CLEANER_DISCOVERY)
    private readonly cleanerDiscovery: CleanerDiscoveryInterface,
    private readonly deliveryScheduler: DeliverySchedulerService,
    private readonly stateMachine: OfferStateMachineService,
    private readonly eventEmitter: OfferEventEmitterService,
    private readonly dataSource: DataSource,
    @InjectQueue(QUEUE_NAMES.RADIUS_EXPANSION)
    private readonly expansionQueue: Queue,
  ) {
    super();
  }

  /**
   * Process a radius expansion job.
   * Validates state, expands radius, discovers Cleaners, delivers.
   */
  async process(
    job: Job<RadiusExpansionJobPayload>,
  ): Promise<ExpansionStepResult> {
    const { isFinalWait } = job.data;

    if (isFinalWait) {
      return this.handleFinalWait(job.data);
    }

    return this.handleExpansionStep(job.data);
  }

  /** Handle a regular expansion step. */
  private async handleExpansionStep(
    payload: RadiusExpansionJobPayload,
  ): Promise<ExpansionStepResult> {
    const { offerId, expectedState, expectedStep } = payload;
    const offer = await this.offersRepository.findById(offerId);

    if (!offer) {
      this.logger.warn(`Offer ${offerId} not found, skipping expansion`);
      return this.buildSkippedResult();
    }

    if (isStaleJob({
      currentState: offer.state,
      currentStep: offer.expansionStepCount,
      expectedState,
      expectedStep,
    })) {
      this.logger.debug(
        `Stale expansion job for offer ${offerId}: state=${offer.state}, step=${offer.expansionStepCount}`,
      );
      return this.buildSkippedResult();
    }

    const newRadius = calculateExpandedRadius(
      offer.currentRadiusMeters,
      1,
      OFFER_EXPANSION_STEP_M,
      OFFER_MAX_RADIUS_M,
    );

    const location = await this.getPropertyLocation(offer.propertyId);
    if (!location) {
      this.logger.error(`Property ${offer.propertyId} location not found`);
      return this.buildSkippedResult();
    }

    const excludedIds = await this.offersRepository.findDeliveredCleanerIds(offerId);

    const cleaners = await this.cleanerDiscovery.findEligibleCleaners({
      lat: location.lat,
      lng: location.lng,
      radiusMeters: newRadius,
      hostId: offer.hostId,
      excludeCleanerIds: excludedIds,
      favoritesFirst: offer.favoritesFirst,
    });

    if (cleaners.length > 0) {
      await this.deliveryScheduler.deliverToCleaners(
        offerId,
        cleaners,
        offer.expansionStepCount,
      );
    }

    const newStep = offer.expansionStepCount + 1;
    await this.offersRepository.updateRadiusExpansion(offerId, newRadius, newStep);

    const maxReached = newRadius >= OFFER_MAX_RADIUS_M;
    await this.scheduleNextJob(offerId, offer.state, newStep, maxReached);

    this.logger.log(
      `Expanded offer ${offerId}: radius=${newRadius}m, step=${newStep}, cleaners=${cleaners.length}`,
    );

    return {
      processed: true,
      currentRadiusMeters: newRadius,
      newCleanersFound: cleaners.length,
      maxRadiusReached: maxReached,
    };
  }

  /** Handle the final wait expiration — expire offer if still active. */
  private async handleFinalWait(
    payload: RadiusExpansionJobPayload,
  ): Promise<ExpansionStepResult> {
    const { offerId } = payload;
    const offer = await this.offersRepository.findById(offerId);

    if (!offer) {
      this.logger.warn(`Offer ${offerId} not found for final wait`);
      return this.buildSkippedResult();
    }

    const isEligibleForExpiry =
      offer.state === OfferState.PUBLISHED || offer.state === OfferState.ACTIVE;

    if (!isEligibleForExpiry) {
      this.logger.debug(
        `Offer ${offerId} no longer eligible for expiry: state=${offer.state}`,
      );
      return this.buildSkippedResult();
    }

    const transitioned = await this.stateMachine.transitionState(
      offerId,
      offer.state as OfferState,
      OfferState.EXPIRED,
      'radius_expansion_processor',
      { reason: 'max_radius_final_wait_elapsed' },
    );

    if (!transitioned) {
      this.logger.debug(`Offer ${offerId} transition to EXPIRED failed (race)`);
      return this.buildSkippedResult();
    }

    await this.dataSource.query(
      `UPDATE offers SET expired_at = NOW() WHERE id = $1`,
      [offerId],
    );

    this.eventEmitter.emitExpired({
      offerId,
      hostId: offer.hostId,
      finalRadius: offer.currentRadiusMeters,
    });

    this.logger.log(`Offer ${offerId} expired after final wait`);

    return {
      processed: true,
      currentRadiusMeters: offer.currentRadiusMeters,
      newCleanersFound: 0,
      maxRadiusReached: true,
    };
  }

  /** Schedule the next expansion job or a final-wait job. */
  private async scheduleNextJob(
    offerId: string,
    currentState: string,
    nextStep: number,
    maxReached: boolean,
  ): Promise<void> {
    if (maxReached) {
      await this.expansionQueue.add(
        `final-wait-${offerId}`,
        {
          offerId,
          expectedState: currentState,
          expectedStep: nextStep,
          isFinalWait: true,
        } satisfies RadiusExpansionJobPayload,
        { delay: OFFER_FINAL_WAIT_MS },
      );
    } else {
      await this.expansionQueue.add(
        `expand-radius-${offerId}`,
        {
          offerId,
          expectedState: currentState,
          expectedStep: nextStep,
        } satisfies RadiusExpansionJobPayload,
        { delay: OFFER_EXPANSION_INTERVAL_MS },
      );
    }
  }

  /** Get lat/lng for a property using PostGIS. */
  private async getPropertyLocation(
    propertyId: string,
  ): Promise<{ lat: number; lng: number } | null> {
    const rows: { lat: number; lng: number }[] = await this.dataSource.query(
      `SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng
       FROM properties WHERE id = $1`,
      [propertyId],
    );

    const first = rows[0];
    if (!first) {
      return null;
    }

    return { lat: first.lat, lng: first.lng };
  }

  /** Build a skipped (stale) result. */
  private buildSkippedResult(): ExpansionStepResult {
    return {
      processed: false,
      currentRadiusMeters: 0,
      newCleanersFound: 0,
      maxRadiusReached: false,
    };
  }
}
