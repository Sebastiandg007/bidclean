/**
 * Offer domain types.
 *
 * Enums, interfaces, and type definitions for the offers module.
 * All monetary values are integers (cents). Rates are basis points (1/100th of %).
 */

/** Offer lifecycle states */
export enum OfferState {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ACTIVE = 'ACTIVE',
  MATCHED = 'MATCHED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

/** Supported cleaning service types */
export enum ServiceType {
  STANDARD = 'standard',
  DEEP = 'deep',
  MOVE_IN_OUT = 'move_in_out',
  POST_CONSTRUCTION = 'post_construction',
  POST_EVENT = 'post_event',
  RECURRING = 'recurring',
}

/** Delivery tiers in priority order */
export enum DeliveryTier {
  FAVORITE = 'FAVORITE',
  PRO = 'PRO',
  FREE = 'FREE',
}

/** Delivery record status */
export enum DeliveryStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

/** Channel used for delivery */
export enum DeliveryChannel {
  WEBSOCKET = 'WEBSOCKET',
  PUSH = 'PUSH',
}

/** Commission breakdown for an offer (all values in cents) */
export interface CommissionBreakdown {
  /** Base price set by Host (cents) */
  readonly offeredPriceCents: number;
  /** Host service fee (cents) — added to offered price */
  readonly hostFeeCents: number;
  /** Total charged to Host (cents) — offeredPrice + hostFee */
  readonly hostTotalCents: number;
  /** Cleaner commission deducted (cents) */
  readonly cleanerCommissionCents: number;
  /** Cleaner payout (cents) — offeredPrice - cleanerCommission */
  readonly cleanerPayoutCents: number;
  /** Host fee rate in basis points */
  readonly hostFeeRateBps: number;
  /** Cleaner commission rate in basis points */
  readonly cleanerRateBps: number;
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  readonly items: T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

/** Offer query filters */
export interface OfferQueryFilters {
  readonly state?: OfferState;
  readonly page?: number;
  readonly pageSize?: number;
  readonly sortBy?: string;
  readonly sortOrder?: 'ASC' | 'DESC';
}
