import { OfferState } from '../offers.types';

/**
 * Offer domain events.
 *
 * Emitted on every state transition via NestJS EventEmitter2.
 * Downstream consumers (payments, chat, tracking, notifications)
 * subscribe to these events without coupling to the offers module.
 */

/** Base event payload shared by all offer domain events */
export interface OfferEventBase {
  readonly offerId: string;
  readonly hostId: string;
  readonly timestamp: Date;
}

/** Emitted when an offer is created (enters DRAFT state) */
export interface OfferCreatedEvent extends OfferEventBase {
  readonly type: 'offer.created';
  readonly propertyId: string;
}

/** Emitted when an offer is published (DRAFT → PUBLISHED) */
export interface OfferPublishedEvent extends OfferEventBase {
  readonly type: 'offer.published';
  readonly propertyId: string;
}

/** Emitted when first delivery succeeds (PUBLISHED → ACTIVE) */
export interface OfferActivatedEvent extends OfferEventBase {
  readonly type: 'offer.activated';
}

/** Emitted when a Cleaner is matched (ACTIVE → MATCHED) */
export interface OfferMatchedEvent extends OfferEventBase {
  readonly type: 'offer.matched';
  readonly cleanerId: string;
  readonly matchSource: string;
}

/** Emitted when an offer is cancelled */
export interface OfferCancelledEvent extends OfferEventBase {
  readonly type: 'offer.cancelled';
  readonly previousState: OfferState;
}

/** Emitted when an offer expires */
export interface OfferExpiredEvent extends OfferEventBase {
  readonly type: 'offer.expired';
}

/** Emitted when a matched offer is completed */
export interface OfferCompletedEvent extends OfferEventBase {
  readonly type: 'offer.completed';
  readonly cleanerId: string;
}

/** Union type of all offer domain events */
export type OfferDomainEvent =
  | OfferCreatedEvent
  | OfferPublishedEvent
  | OfferActivatedEvent
  | OfferMatchedEvent
  | OfferCancelledEvent
  | OfferExpiredEvent
  | OfferCompletedEvent;
