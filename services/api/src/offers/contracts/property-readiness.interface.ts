/**
 * Property readiness contract interface.
 *
 * Defines the cross-module boundary between offers and properties.
 * The offers module calls this to validate that a property is eligible
 * for offer creation (exists, owned, not deleted, has photos, has location, etc.).
 *
 * Implementation lives in the properties module and is injected via DI token.
 */

/** Result of a property readiness check */
export interface PropertyReadinessResult {
  /** Whether the property is ready for offer creation */
  readonly ready: boolean;
  /** Reasons why the property is NOT ready (empty if ready) */
  readonly reasons: string[];
}

/** Contract interface for property readiness checks */
export interface PropertyReadinessInterface {
  /**
   * Check if a property is ready for an offer to be created.
   *
   * @param propertyId - The property UUID
   * @param hostId - The Host user UUID (for ownership verification)
   * @returns Readiness result with reasons array
   */
  check(propertyId: string, hostId: string): Promise<PropertyReadinessResult>;
}

/** DI token for PropertyReadinessInterface */
export const PROPERTY_READINESS = Symbol('PROPERTY_READINESS');
