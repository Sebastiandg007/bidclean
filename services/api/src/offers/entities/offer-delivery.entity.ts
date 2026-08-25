/**
 * Offer delivery entity.
 *
 * Maps to the `offer_deliveries` table.
 * Tracks which Cleaners received which offers, via which channel,
 * at which tier and radius step. Used for:
 * - Excluding already-delivered Cleaners from expansion
 * - Sending cancellation notifications to delivered Cleaners
 * - Analytics on delivery success rates per tier/channel
 */
export class OfferDelivery {
  // TODO: Add TypeORM decorators in Task 6
}
