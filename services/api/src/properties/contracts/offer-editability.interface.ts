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
