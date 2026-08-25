import { OfferState } from '../offers.types';

/**
 * Offer domain events.
 *
 * Emitted on every state transition via NestJS EventEmitter2.
 * Downstream consumers (payments, chat, tracking, notifications)
 * subscribe to these events without coupling to the offers module.
 */

/** Type-safe event name constants (dot-notated for EventEmitter2) */
export const OFFER_EVENT_NAMES = {
  CREATED: 'offer.created',
  PUBLISHED: 'offer.published',
  ACTIVATED: 'offer.activated',
  MATCHED: 'offer.matched',
  CANCELLED: 'offer.cancelled',
  EXPIRED: 'offer.expired',
  COMPLETED: 'offer.completed',
} as const;

/** Union of all valid offer event name strings */
export type OfferEventName = (typeof OFFER_EVENT_NAMES)[keyof typeof OFFER_EVENT_NAMES];

/** Base event payload shared by all offer domain events */
export interface OfferEventBase {
  readonly offerId: string;
  readonly hostId: string;
  readonly timestamp: Date;
}

/** Emitted when an offer is created (enters DRAFT state) */
export interface OfferCreatedEvent extends OfferEventBase {
  readonly type: typeof OFFER_EVENT_NAMES.CREATED;
  readonly propertyId: string;
}

/** Emitted when an offer is published (DRAFT → PUBLISHED) */
export interface OfferPublishedEvent extends OfferEventBase {
  readonly type: typeof OFFER_EVENT_NAMES.PUBLISHED;
  readonly propertyId: string;
}

/** Emitted when first delivery succeeds (PUBLISHED → ACTIVE) */
export interface OfferActivatedEvent extends OfferEventBase {
  readonly type: typeof OFFER_EVENT_NAMES.ACTIVATED;
}

/** Emitted when a Cleaner is matched (ACTIVE → MATCHED) */
export interface OfferMatchedEvent extends OfferEventBase {
  readonly type: typeof OFFER_EVENT_NAMES.MATCHED;
  readonly cleanerId: string;
  readonly matchSource: string;
}

/** Emitted when an offer is cancelled */
export interface OfferCancelledEvent extends OfferEventBase {
  readonly type: typeof OFFER_EVENT_NAMES.CANCELLED;
  readonly previousState: OfferState;
}

/** Emitted when an offer expires */
export interface OfferExpiredEvent extends OfferEventBase {
  readonly type: typeof OFFER_EVENT_NAMES.EXPIRED;
  readonly finalRadius: number;
}

/** Emitted when a matched offer is completed */
export interface OfferCompletedEvent extends OfferEventBase {
  readonly type: typeof OFFER_EVENT_NAMES.COMPLETED;
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
