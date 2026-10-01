import { NotificationIntent } from '../notifications.types';
import { OutboxEntityBase } from '../entities/outbox.entity';

/**
 * A per-domain mapper turns an outbox row into a NotificationIntent (or null when the row is not
 * notification-worthy for any recipient). The domain -> intent mapping lives HERE (in the
 * notifications module), never in `@bidclean/shared`.
 */
export interface OutboxMapper {
  /** The event `type` values this mapper handles. */
  readonly handledTypes: ReadonlySet<string>;
  /** Map a row to an intent, or null to skip (e.g. unknown recipient). */
  map(row: OutboxEntityBase): NotificationIntent | null;
}

/**
 * Build the deterministic ledger dedup key from the outbox `event_id` + `version` + recipient.
 * Two relays/workers seeing the same event derive the same key, so the ledger's UNIQUE constraint
 * makes the intent exactly-once.
 */
export function deriveDedupKey(eventId: string, version: number, recipientUserId: string): string {
  return `${eventId}:v${version}:${recipientUserId}`;
}

/** Read a required string id from an outbox payload, or null when absent/mistyped. */
export function readId(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
