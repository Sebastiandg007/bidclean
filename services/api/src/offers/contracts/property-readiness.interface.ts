/**
 * Property readiness contract interface.
 *
 * Defines the cross-module boundary between offers and properties.
 * The offers module calls this to validate that a property is eligible
 * for offer creation (exists, owned, not deleted, has photos, has location, etc.).
 *
 * Implementation lives in the offers module and uses DataSource for cross-table access.
 */

/**
 * Type-safe enumeration of all possible readiness failure reasons.
 * Each reason maps to a specific validation step in the readiness check.
 */
export type PropertyReadinessFailure =
  | 'NOT_FOUND'
  | 'NOT_OWNED'
  | 'DELETED'
  | 'NO_PHOTOS'
  | 'INVALID_LOCATION'
  | 'MISSING_REQUIRED_FIELDS'
  | 'HAS_ACTIVE_OFFER';

/** Result of a property readiness check */
export interface PropertyReadinessResult {
  /** Whether the property is ready for offer creation */
  readonly ready: boolean;
  /** Reasons why the property is NOT ready (empty if ready) */
  readonly reasons: PropertyReadinessFailure[];
}

/** Contract interface for property readiness checks */
export interface PropertyReadinessInterface {
  /**
   * Check if a property is ready for an offer to be created.
   *
   * Validates in order:
   * 1. NOT_FOUND — property does not exist
   * 2. NOT_OWNED — property belongs to a different user
   * 3. DELETED — property is soft-deleted
   * 4. NO_PHOTOS — property has zero photos
   * 5. INVALID_LOCATION — location column is null/empty
   * 6. MISSING_REQUIRED_FIELDS — name, type, address_street, address_city, address_country, square_meters, or bathrooms missing
   * 7. HAS_ACTIVE_OFFER — an offer exists in DRAFT, PUBLISHED, or ACTIVE state
   *
   * @param propertyId - The property UUID
   * @param hostId - The Host user UUID (for ownership verification)
   * @returns Readiness result with typed reasons array
   */
  check(propertyId: string, hostId: string): Promise<PropertyReadinessResult>;
}

/** DI token for PropertyReadinessInterface */
export const PROPERTY_READINESS = Symbol('PROPERTY_READINESS');
