/**
 * Offer match contract interface.
 *
 * Exposed to external modules (offer-negotiation, offer-radar) to execute
 * the ACTIVE → MATCHED state transition when a Cleaner accepts an offer.
 * Only this contract can trigger the match transition.
 */

/** Result of a match attempt */
export interface MatchResult {
  /** Whether the match succeeded */
  readonly success: boolean;
  /** Error reason if match failed */
  readonly reason?: string;
}

/** Source that triggered the match */
export type MatchSource = 'direct_accept' | 'negotiation' | 'auto_assign';

/** Contract interface for offer matching */
export interface OfferMatchInterface {
  /**
   * Match a Cleaner to an offer (ACTIVE → MATCHED).
   *
   * @param offerId - The offer UUID
   * @param cleanerId - The Cleaner user UUID
   * @param matchSource - What triggered the match
   * @returns Match result (success or failure with reason)
   */
  match(
    offerId: string,
    cleanerId: string,
    matchSource: MatchSource,
  ): Promise<MatchResult>;
}

/** DI token for OfferMatchInterface */
export const OFFER_MATCH = Symbol('OFFER_MATCH');
