/**
 * Offers screen types — Offer interface, OfferState, ServiceType,
 * CreateOfferPayload, PriceBreakdown, pagination, and route params.
 */

// ─── Enums / Unions ──────────────────────────────────────────────────────────

export type OfferState =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'ACTIVE'
  | 'MATCHED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

export type ServiceType =
  | 'standard'
  | 'deep'
  | 'move_in_out'
  | 'post_construction'
  | 'post_event'
  | 'recurring';

// ─── Offer ───────────────────────────────────────────────────────────────────

export interface Offer {
  id: string;
  hostId: string;
  propertyId: string;
  serviceType: ServiceType;
  description: string | null;
  scheduledAt: string;
  timezone: string;
  estimatedDurationMinutes: number;

  /** All monetary values in cents */
  offeredPriceCents: number;
  currency: string;
  hostServiceFeeCents: number;
  hostTotalCents: number;
  cleanerCommissionCents: number;
  cleanerPayoutCents: number;

  /** Rate snapshot in basis points */
  hostServiceFeeRateBps: number;
  cleanerCommissionRateBps: number;

  /** Property snapshot (immutable after publish) */
  propertyNameSnapshot: string | null;
  propertyTypeSnapshot: string | null;
  propertyCitySnapshot: string | null;
  propertyCoverPhotoSnapshot: string | null;

  state: OfferState;
  favoritesFirst: boolean;

  /** Radius expansion tracking */
  currentRadiusMeters: number;
  expansionStepCount: number;

  /** Timestamps */
  publishedAt: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  matchedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;

  /** State transition history (included in detail response) */
  stateTransitions?: OfferStateTransition[];
}

export interface OfferStateTransition {
  id: string;
  offerId: string;
  fromState: OfferState | null;
  toState: OfferState;
  triggeredBy: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ─── Price Breakdown ─────────────────────────────────────────────────────────

export interface PriceBreakdown {
  offeredPriceCents: number;
  currency: string;
  hostServiceFeeCents: number;
  hostTotalCents: number;
  cleanerCommissionCents: number;
  cleanerPayoutCents: number;
  hostServiceFeeRateBps: number;
  cleanerCommissionRateBps: number;
}

// ─── Create Offer Payload ────────────────────────────────────────────────────

export interface CreateOfferPayload {
  propertyId: string;
  serviceType: ServiceType;
  description?: string;
  scheduledAt: string;
  timezone: string;
  estimatedDurationMinutes: number;
  offeredPriceCents: number;
  currency: string;
}

// ─── Publish Offer Payload ───────────────────────────────────────────────────

export interface PublishOfferPayload {
  favoritesFirst: boolean;
}

// ─── API Response Types ──────────────────────────────────────────────────────

export interface CreateOfferResponse {
  id: string;
}

export interface OffersListResponse {
  data: Offer[];
  page: number;
  totalPages: number;
  hasMore: boolean;
}

// ─── Route Params ────────────────────────────────────────────────────────────

export interface OfferDetailRouteParams {
  offerId: string;
}

export interface OfferConfirmationRouteParams {
  offerId: string;
}
