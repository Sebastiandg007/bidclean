import { Subscription } from '../../entities/subscription.entity';
import { SubscriptionEvent } from '../../entities/subscription-event.entity';
import { DispatchStatus } from '../../subscriptions.types';

/**
 * A minimal in-memory stand-in for TypeORM's DataSource, modelling ONLY the operations
 * SubscriptionsRepository performs against `subscriptions` and `subscription_events`.
 *
 * It is deliberately small and behavioral (not a general ORM): it lets the repository's
 * invariants — dedup via unique violation, per-entitlement ordering, atomic TRANSFER,
 * dispatch lifecycle, discovery, deletion cleanup — be tested without live Postgres.
 */

const UNIQUE_VIOLATION = '23505';

class UniqueViolationError extends Error {
  readonly code = UNIQUE_VIOLATION;
}

type Table = 'Subscription' | 'SubscriptionEvent';

function tableFor(entity: unknown): Table {
  return entity === Subscription ? 'Subscription' : 'SubscriptionEvent';
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class InMemoryDataSource {
  readonly subscriptions: Subscription[] = [];
  readonly events: SubscriptionEvent[] = [];

  getRepository(entity: unknown): InMemoryRepository {
    return new InMemoryRepository(this, tableFor(entity));
  }

  /** Runs the callback with a manager whose getRepository shares this same store. */
  async transaction<T>(work: (manager: { getRepository: (e: unknown) => InMemoryRepository }) => Promise<T>): Promise<T> {
    return work({ getRepository: (e: unknown) => this.getRepository(e) });
  }

  rows(table: Table): Array<Record<string, unknown>> {
    return (table === 'Subscription' ? this.subscriptions : this.events) as unknown as Array<
      Record<string, unknown>
    >;
  }
}

/** Matches TypeORM's simple `where` object semantics used by the repository. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => applyCondition(row[key], condition));
}

function applyCondition(value: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === 'object' && '_type' in (condition as object)) {
    return applyOperator(value, condition as FindOperatorLike);
  }
  return value === condition;
}

/** A structural subset of TypeORM's FindOperator we need (In, LessThan, IsNull). */
interface FindOperatorLike {
  readonly _type: string;
  readonly _value: unknown;
}

function applyOperator(value: unknown, op: FindOperatorLike): boolean {
  switch (op._type) {
    case 'in':
      return Array.isArray(op._value) && op._value.includes(value);
    case 'lessThan':
      return value instanceof Date && op._value instanceof Date
        ? value.getTime() < op._value.getTime()
        : (value as number) < (op._value as number);
    case 'isNull':
      return value === null || value === undefined;
    default:
      return false;
  }
}

export class InMemoryRepository {
  constructor(private readonly db: InMemoryDataSource, private readonly table: Table) {}

  /** Mirrors TypeORM's `create`: returns a plain object copy of the given values. */
  create(values: Record<string, unknown>): Record<string, unknown> {
    return { ...values };
  }

  async findOne(options: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null> {
    return this.db.rows(this.table).find((row) => matches(row, options.where)) ?? null;
  }

  async find(options?: {
    where?: Record<string, unknown>;
    order?: Record<string, 'ASC' | 'DESC'>;
    take?: number;
    select?: Record<string, boolean>;
  }): Promise<Array<Record<string, unknown>>> {
    let result = this.db.rows(this.table).filter((row) => (options?.where ? matches(row, options.where) : true));
    result = this.applyOrder(result, options?.order);
    if (options?.take !== undefined) {
      result = result.slice(0, options.take);
    }
    return result;
  }

  async count(options: { where: Record<string, unknown> }): Promise<number> {
    return this.db.rows(this.table).filter((row) => matches(row, options.where)).length;
  }

  async insert(values: Record<string, unknown>): Promise<{ identifiers: Array<{ id: string }> }> {
    const row = this.persist(values);
    return { identifiers: [{ id: row.id as string }] };
  }

  /** Mirrors TypeORM's `save`: persists and returns the row (with its generated id). */
  async save(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.persist(values);
  }

  private persist(values: Record<string, unknown>): Record<string, unknown> {
    this.enforceUnique(values);
    const id = nextId(this.table === 'Subscription' ? 'sub' : 'evt');
    const row = this.withDefaults(id, values);
    this.db.rows(this.table).push(row);
    return row;
  }

  async update(where: Record<string, unknown>, patch: Record<string, unknown>): Promise<void> {
    for (const row of this.db.rows(this.table)) {
      if (matches(row, where)) {
        Object.assign(row, patch);
      }
    }
  }

  async delete(where: Record<string, unknown>): Promise<void> {
    const rows = this.db.rows(this.table);
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const current = rows[i];
      if (current && matches(current, where)) {
        rows.splice(i, 1);
      }
    }
  }

  createQueryBuilder(_alias: string): InMemoryQueryBuilder {
    return new InMemoryQueryBuilder(this.db.rows(this.table));
  }

  private applyOrder(
    rows: Array<Record<string, unknown>>,
    order?: Record<string, 'ASC' | 'DESC'>,
  ): Array<Record<string, unknown>> {
    if (!order) {
      return rows;
    }
    const [key, direction] = Object.entries(order)[0] ?? [];
    if (!key) {
      return rows;
    }
    return [...rows].sort((a, b) => {
      const av = toComparable(a[key]);
      const bv = toComparable(b[key]);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return direction === 'DESC' ? -cmp : cmp;
    });
  }

  private enforceUnique(values: Record<string, unknown>): void {
    if (this.table === 'SubscriptionEvent' && values.revenuecatEventId !== undefined) {
      const clash = this.db.events.some((e) => e.revenuecatEventId === values.revenuecatEventId);
      if (clash) {
        throw new UniqueViolationError('duplicate revenuecat_event_id');
      }
    }
    if (this.table === 'Subscription' && values.userId !== undefined) {
      const clash = this.db.subscriptions.some((s) => s.userId === values.userId);
      if (clash) {
        throw new UniqueViolationError('duplicate user_id');
      }
    }
  }

  private withDefaults(id: string, values: Record<string, unknown>): Record<string, unknown> {
    const now = new Date();
    if (this.table === 'Subscription') {
      return {
        id,
        userId: values.userId,
        cleanerProActive: false,
        cleanerProExpiresAt: null,
        cleanerProStore: null,
        cleanerProLastEventAt: null,
        hostProActive: false,
        hostProExpiresAt: null,
        hostProStore: null,
        hostProLastEventAt: null,
        adFreeActive: false,
        adFreeExpiresAt: null,
        adFreeStore: null,
        adFreeLastEventAt: null,
        lastReconciledAt: null,
        createdAt: now,
        updatedAt: now,
        ...values,
      };
    }
    return {
      id,
      dispatchStatus: DispatchStatus.RECEIVED,
      processedAt: null,
      createdAt: now,
      ...values,
    };
  }
}

function toComparable(value: unknown): number | string {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value === null || value === undefined) {
    return Number.NEGATIVE_INFINITY;
  }
  return value as number | string;
}

/** Models the FOR UPDATE lookup: `.setLock().where('s.user_id = :userId').getOne()`. */
export class InMemoryQueryBuilder {
  private userId: string | null = null;

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  setLock(_mode: string): this {
    return this;
  }

  where(_clause: string, params: { userId: string }): this {
    this.userId = params.userId;
    return this;
  }

  async getOne(): Promise<Record<string, unknown> | null> {
    return this.rows.find((row) => row.userId === this.userId) ?? null;
  }
}
