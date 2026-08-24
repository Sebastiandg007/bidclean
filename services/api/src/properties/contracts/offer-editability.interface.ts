/**
 * Offer-editability contract interface.
 *
 * The property module delegates "can this property be edited?" decisions
 * to the offer domain. Until offer-publishing is implemented, the default
 * implementation returns { editable: true, blockedFields: [] }.
 *
 * When the offer-publishing spec is built, it will provide a real
 * implementation that blocks edits on properties with active offers.
 */

import { Injectable } from '@nestjs/common';

/** DI token for the offer-editability contract */
export const OFFER_EDITABILITY_CHECK = 'OFFER_EDITABILITY_CHECK';

export interface OfferEditabilityCheck {
  /**
   * Determines whether a property can be modified given the current offer state.
   * @param propertyId - UUID of the property to check
   * @param fields - List of field names being modified
   * @returns Editability result with blocked fields and optional reason
   */
  canModifyProperty(
    propertyId: string,
    fields: string[],
  ): Promise<OfferEditabilityResult>;
}

export interface OfferEditabilityResult {
  readonly editable: boolean;
  readonly blockedFields: string[];
  readonly reason?: string;
}

/**
 * Default offer-editability implementation.
 *
 * Always allows edits — returns { editable: true, blockedFields: [] }
 * for all properties and fields. This will be replaced by a real
 * implementation when the offer-publishing spec is built.
 */
@Injectable()
export class DefaultOfferEditabilityCheck implements OfferEditabilityCheck {
  /**
   * Returns editable=true unconditionally until offer-publishing
   * provides a real implementation that checks active offer state.
   */
  async canModifyProperty(
    _propertyId: string,
    _fields: string[],
  ): Promise<OfferEditabilityResult> {
    return { editable: true, blockedFields: [] };
  }
}

/** DI token for the property-readiness contract */
export const PROPERTY_READINESS_CHECK = 'PROPERTY_READINESS_CHECK';

/**
 * Property-readiness contract interface.
 *
 * Determines if a property is ready to be used in an offer.
 * This is a CALCULATED state (not stored) — always derived from current data.
 */
export interface PropertyReadinessCheck {
  /**
   * Checks if a property meets all requirements for offer publishing.
   * @param propertyId - UUID of the property to check
   * @returns Readiness result with reasons if not ready
   */
  isOfferReady(propertyId: string): Promise<PropertyReadinessResult>;
}

export interface PropertyReadinessResult {
  readonly ready: boolean;
  readonly reasons: string[];
}
