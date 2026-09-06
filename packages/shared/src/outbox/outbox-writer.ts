/**
 * Domain-agnostic transactional outbox writer.
 *
 * Pure infrastructure: it writes ONE row into a caller-named outbox table within the caller's
 * transaction. It carries NO domain semantics (no offer/payment/negotiation/chat/voip knowledge),
 * no domain mapping, and no business branches. Each bounded context owns its own outbox table and
 * is the only writer to it; the per-domain `eventId` derivation and payload shaping happen in the
 * emitting domain (the caller), never here. The domain -> notification-intent mapping lives only in
 * the notifications module. This invariant keeps `@bidclean/shared` free of any domain semantics.
 */

/** The minimal executor abstraction: anything that can run a parameterized query in a transaction. */
export interface OutboxQueryExecutor {
  /**
   * Execute a parameterized SQL statement. Mirrors TypeORM `EntityManager.query` /
   * `QueryRunner.query`, so callers pass their in-transaction manager directly.
   */
  query(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
}

/** The shape of a single outbox row to write. All fields are supplied by the caller (the domain). */
export interface OutboxRow {
  /** Deterministic, globally-unique id for the business fact; the source of the ledger dedup key. */
  readonly eventId: string;
  /** The aggregate kind this row is about (e.g. an app-validated short code), caller-defined. */
  readonly aggregateType: string;
  /** The aggregate's entity id (the fact's owning row). */
  readonly aggregateId: string;
  /** The event type discriminator (caller-defined; no meaning is interpreted here). */
  readonly type: string;
  /** Minimal payload the relay needs to build an intent (ids/labels only; no sensitive content). */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Payload schema/version; part of the downstream dedup derivation. Defaults to 1. */
  readonly version?: number;
  /** The physical outbox table name owned by the caller's bounded context. */
  readonly tableName: string;
}

/** Default payload version when a caller does not specify one. */
const DEFAULT_OUTBOX_VERSION = 1;

/**
 * Validate that a table name is a bare SQL identifier before it is interpolated.
 *
 * The table name is caller-provided (a constant owned by the domain), never end-user input, but it
 * cannot be a bound parameter in SQL. Restricting it to `[A-Za-z_][A-Za-z0-9_]*` makes the
 * interpolation injection-safe by construction.
 */
function assertSafeTableName(tableName: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error(`Unsafe outbox table name: ${tableName}`);
  }
}

/**
 * Write a single outbox row into `row.tableName` using the caller's transactional executor.
 *
 * The INSERT is parameterized (values are bound, never concatenated). The row must be written in
 * the SAME transaction as the business fact so the trigger is atomic with the fact. This function
 * performs no domain logic and returns nothing meaningful beyond completion.
 */
export async function writeOutbox(tx: OutboxQueryExecutor, row: OutboxRow): Promise<void> {
  assertSafeTableName(row.tableName);
  const version = row.version ?? DEFAULT_OUTBOX_VERSION;
  await tx.query(
    `INSERT INTO "${row.tableName}"
       ("event_id", "aggregate_type", "aggregate_id", "type", "payload", "version")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.eventId, row.aggregateType, row.aggregateId, row.type, JSON.stringify(row.payload), version],
  );
}