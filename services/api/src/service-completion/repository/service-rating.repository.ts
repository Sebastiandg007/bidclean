import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { OutboxRow, writeOutbox } from '../../common/outbox/outbox-writer';
import { RatingRole } from '../completion.types';

/** A raw rating row (snake_case as stored). */
export interface ServiceRatingRow {
  readonly id: string;
  readonly service_completion_id: string;
  readonly role: string;
  readonly stars: number;
  readonly comment: string | null;
  readonly created_at: Date;
}

/** Params for inserting one rating side. */
export interface InsertRatingParams {
  readonly serviceCompletionId: string;
  readonly raterId: string;
  readonly rateeId: string;
  readonly role: RatingRole;
  readonly stars: number;
  readonly comment: string | null;
}

/**
 * ServiceRatingRepository (`service_ratings` + co-write to `completion_outbox`) — parameterized SQL
 * only (Spec 20).
 *
 * `insertOnePerSide` is `ON CONFLICT (service_completion_id, role) DO NOTHING` and, on a real
 * insert, co-writes `service_rated` in the SAME transaction. Never touches `service_completions`
 * state or `release_intents` — a rating is captured, never gating.
 */
@Injectable()
export class ServiceRatingRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Insert one rating side (idempotent per side) and, on a real insert, co-write the outbox row.
   * Returns true when this call inserted the rating (winner), false for a duplicate side.
   */
  async insertOnePerSide(params: InsertRatingParams, outbox: OutboxRow): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const inserted = await manager.query<Array<{ id: string }>>(
        `INSERT INTO "service_ratings"
           ("service_completion_id", "rater_id", "ratee_id", "role", "stars", "comment")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("service_completion_id", "role") DO NOTHING
         RETURNING "id"`,
        [
          params.serviceCompletionId,
          params.raterId,
          params.rateeId,
          params.role,
          params.stars,
          params.comment,
        ],
      );
      if (inserted[0] === undefined) {
        return false;
      }
      await writeOutbox(manager, outbox);
      return true;
    });
  }

  /** All ratings for a completion (participant-gated read). */
  async findByCompletion(completionId: string): Promise<ServiceRatingRow[]> {
    return this.dataSource.query<ServiceRatingRow[]>(
      `SELECT "id", "service_completion_id", "role", "stars", "comment", "created_at"
       FROM "service_ratings"
       WHERE "service_completion_id" = $1
       ORDER BY "created_at" ASC`,
      [completionId],
    );
  }
}
