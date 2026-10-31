import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ObjectDeletionStatus } from '../dispute.types';

/** A pending tombstone row awaiting MinIO object removal. */
export interface PendingTombstone {
  readonly objectKey: string;
}

/**
 * DisputeObjectDeletionRepository (`dispute_object_deletions`) — parameterized SQL only (Spec 21).
 *
 * Drains the tombstones the `BEFORE DELETE` trigger writes when a `dispute_evidence` HOST_PHOTO row
 * is deleted (direct or via CASCADE), so the cleanup worker can remove the freed MinIO object even
 * after the metadata row is gone. Idempotent.
 */
@Injectable()
export class DisputeObjectDeletionRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Select the oldest PENDING tombstones, bounded by `limit`. */
  async drainPending(limit: number): Promise<PendingTombstone[]> {
    const rows = await this.dataSource.query<Array<{ object_key: string }>>(
      `SELECT "object_key"
       FROM "dispute_object_deletions"
       WHERE "status" = $1
       ORDER BY "created_at" ASC
       LIMIT $2`,
      [ObjectDeletionStatus.PENDING, limit],
    );
    return rows.map((row) => ({ objectKey: row.object_key }));
  }

  /** Mark a tombstone DONE once its MinIO object has been removed. Idempotent. */
  async markDone(objectKey: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "dispute_object_deletions"
       SET "status" = $1, "processed_at" = NOW()
       WHERE "object_key" = $2`,
      [ObjectDeletionStatus.DONE, objectKey],
    );
  }
}
