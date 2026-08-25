/**
 * Stale job guard utility.
 *
 * Validates that a BullMQ job's expected state and step match
 * the current offer state. If they don't match, the job is stale
 * (another process already advanced the offer) and should be skipped.
 *
 * This makes all BullMQ jobs idempotent — stale jobs complete
 * without side effects, no retry, no error.
 */

/** Parameters to validate a job against current offer state */
export interface StaleJobCheckParams {
  /** Current offer state from database */
  readonly currentState: string;
  /** Current expansion step from database */
  readonly currentStep: number;
  /** Expected state from job payload */
  readonly expectedState: string;
  /** Expected step from job payload */
  readonly expectedStep: number;
}

/**
 * Check if a BullMQ job is stale.
 * @returns true if the job is stale and should be skipped
 */
export function isStaleJob(params: StaleJobCheckParams): boolean {
  return (
    params.currentState !== params.expectedState ||
    params.currentStep !== params.expectedStep
  );
}
