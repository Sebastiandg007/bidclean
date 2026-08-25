import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OfferState } from '../offers.types';
import {
  OFFER_EVENT_NAMES,
  OfferCreatedEvent,
  OfferPublishedEvent,
  OfferActivatedEvent,
  OfferMatchedEvent,
  OfferCancelledEvent,
  OfferExpiredEvent,
  OfferCompletedEvent,
  OfferDomainEvent,
} from './offer-domain-events';

/** Parameters for emitting an OfferCreated event */
interface EmitCreatedParams {
  readonly offerId: string;
  readonly hostId: string;
  readonly propertyId: string;
}

/** Parameters for emitting an OfferPublished event */
interface EmitPublishedParams {
  readonly offerId: string;
  readonly hostId: string;
  readonly propertyId: string;
}

/** Parameters for emitting an OfferActivated event */
interface EmitActivatedParams {
  readonly offerId: string;
  readonly hostId: string;
}

/** Parameters for emitting an OfferMatched event */
interface EmitMatchedParams {
  readonly offerId: string;
  readonly hostId: string;
  readonly cleanerId: string;
  readonly matchSource: string;
}

/** Parameters for emitting an OfferCancelled event */
interface EmitCancelledParams {
  readonly offerId: string;
  readonly hostId: string;
  readonly previousState: OfferState;
}

/** Parameters for emitting an OfferExpired event */
interface EmitExpiredParams {
  readonly offerId: string;
  readonly hostId: string;
  readonly finalRadius: number;
}

/** Parameters for emitting an OfferCompleted event */
interface EmitCompletedParams {
  readonly offerId: string;
  readonly hostId: string;
  readonly cleanerId: string;
}

/**
 * Offer event emitter service.
 *
 * Emits domain events on every offer state transition via NestJS EventEmitter2.
 * Provides typed emit methods for each event, ensuring payload correctness at compile time.
 *
 * Consumers subscribe via @OnEvent decorators in their own modules.
 */
@Injectable()
export class OfferEventEmitterService {
  private readonly logger = new Logger(OfferEventEmitterService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /** Emit an OfferCreated event when an offer enters DRAFT state */
  emitCreated(params: EmitCreatedParams): void {
    const event: OfferCreatedEvent = {
      type: OFFER_EVENT_NAMES.CREATED,
      offerId: params.offerId,
      hostId: params.hostId,
      propertyId: params.propertyId,
      timestamp: new Date(),
    };
    this.emitEvent(event);
  }

  /** Emit an OfferPublished event on DRAFT → PUBLISHED transition */
  emitPublished(params: EmitPublishedParams): void {
    const event: OfferPublishedEvent = {
      type: OFFER_EVENT_NAMES.PUBLISHED,
      offerId: params.offerId,
      hostId: params.hostId,
      propertyId: params.propertyId,
      timestamp: new Date(),
    };
    this.emitEvent(event);
  }

  /** Emit an OfferActivated event on PUBLISHED → ACTIVE transition */
  emitActivated(params: EmitActivatedParams): void {
    const event: OfferActivatedEvent = {
      type: OFFER_EVENT_NAMES.ACTIVATED,
      offerId: params.offerId,
      hostId: params.hostId,
      timestamp: new Date(),
    };
    this.emitEvent(event);
  }

  /** Emit an OfferMatched event on ACTIVE → MATCHED transition */
  emitMatched(params: EmitMatchedParams): void {
    const event: OfferMatchedEvent = {
      type: OFFER_EVENT_NAMES.MATCHED,
      offerId: params.offerId,
      hostId: params.hostId,
      cleanerId: params.cleanerId,
      matchSource: params.matchSource,
      timestamp: new Date(),
    };
    this.emitEvent(event);
  }

  /** Emit an OfferCancelled event when an offer is cancelled */
  emitCancelled(params: EmitCancelledParams): void {
    const event: OfferCancelledEvent = {
      type: OFFER_EVENT_NAMES.CANCELLED,
      offerId: params.offerId,
      hostId: params.hostId,
      previousState: params.previousState,
      timestamp: new Date(),
    };
    this.emitEvent(event);
  }

  /** Emit an OfferExpired event when an offer expires */
  emitExpired(params: EmitExpiredParams): void {
    const event: OfferExpiredEvent = {
      type: OFFER_EVENT_NAMES.EXPIRED,
      offerId: params.offerId,
      hostId: params.hostId,
      finalRadius: params.finalRadius,
      timestamp: new Date(),
    };
    this.emitEvent(event);
  }

  /** Emit an OfferCompleted event on MATCHED → COMPLETED transition */
  emitCompleted(params: EmitCompletedParams): void {
    const event: OfferCompletedEvent = {
      type: OFFER_EVENT_NAMES.COMPLETED,
      offerId: params.offerId,
      hostId: params.hostId,
      cleanerId: params.cleanerId,
      timestamp: new Date(),
    };
    this.emitEvent(event);
  }

  /** Internal: emit the event via EventEmitter2 and log at debug level */
  private emitEvent(event: OfferDomainEvent): void {
    this.logger.debug(
      `Emitting ${event.type} for offer ${event.offerId}`,
    );
    this.eventEmitter.emit(event.type, event);
  }
}
