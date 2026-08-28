import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NegotiationOperation } from './negotiation.types';

/**
 * Negotiation idempotency service.
 *
 * Guarantees Correctness Property P9: a mutation replayed with the same
 * (user_id, operation, idempotency_key) returns the cached result and never
 * creates a duplicate proposal or a second match.
 *
 * Strategy: before running the operation, look up a cached result. If present,
 * return it. Otherwise run the operation, persist the serialized result, and
 * return it. The unique constraint on (user_id, operation, idempotency_key)
 * protects against a concurrent duplicate: if the insert races and violates the
 * constraint, we read back the previously stored result.
 */
@Injectable()
export class NegotiationIdempotencyService {
  private readonly logger = new Logger(NegotiationIdempotencyService.name);

  /** Postgres unique-violation error code */
  private static readonly UNIQUE_VIOLATION = '23505';

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Run an operation at most once per (userId, operation, key).
   *
   * @param userId - Acting user ID
   * @param operation - Named operation for scoping
   * @param key - Client-generated idempotency key
   * @param work - The operation to execute if not already processed
   * @returns The fresh or cached result
   */
  async runOnce<T>(
    userId: string,
    operation: NegotiationOperation,
    key: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.readCached<T>(userId, operation, key);
    if (cached !== null) {
      this.logger.debug(`Idempotent replay for ${operation} (user ${userId})`);
      return cached;
    }

    const result = await work();

    try {
      await this.dataSource.query(
        `INSERT INTO "negotiation_idempotency" ("user_id", "operation", "idempotency_key", "result_json")
         VALUES ($1, $2, $3, $4)`,
        [userId, operation, key, JSON.stringify(result)],
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        // A concurrent request already stored a result — return the stored one.
        const raced = await this.readCached<T>(userId, operation, key);
        if (raced !== null) {
          return raced;
        }
      }
      throw error;
    }

    return result;
  }

  /** Read a cached result, or null if none exists. */
  private async readCached<T>(
    userId: string,
    operation: NegotiationOperation,
    key: string,
  ): Promise<T | null> {
    const rows = await this.dataSource.query<{ result_json: T }[]>(
      `SELECT "result_json" FROM "negotiation_idempotency"
       WHERE "user_id" = $1 AND "operation" = $2 AND "idempotency_key" = $3
       LIMIT 1`,
      [userId, operation, key],
    );
    const first = rows[0];
    return first ? first.result_json : null;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === NegotiationIdempotencyService.UNIQUE_VIOLATION
    );
  }
}
