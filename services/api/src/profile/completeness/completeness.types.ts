/**
 * Completeness types.
 */

/** Configuration for a single completeness field weight */
export interface CompletenessFieldWeight {
  readonly name: string;
  readonly weight: number;
}

/** Completeness configuration for a role */
export interface RoleCompletenessConfig {
  readonly role: string;
  readonly fields: CompletenessFieldWeight[];
}
