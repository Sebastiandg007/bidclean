/**
 * Types for the radius expansion BullMQ processor.
 */

/** BullMQ job payload for radius expansion */
export interface RadiusExpansionJobPayload {
  /** Offer being expanded */
  readonly offerId: string;
  /** Expected offer state (stale job guard) */
  readonly expectedState: string;
  /** Expected expansion step index (stale job guard) */
  readonly expectedStep: number;
}

/** Result of processing an expansion step */
export interface ExpansionStepResult {
  /** Whether the job was processed (false = stale, skipped) */
  readonly processed: boolean;
  /** Current radius after expansion in meters */
  readonly currentRadiusMeters: number;
  /** Number of new Cleaners discovered in this step */
  readonly newCleanersFound: number;
  /** Whether max radius has been reached */
  readonly maxRadiusReached: boolean;
}
