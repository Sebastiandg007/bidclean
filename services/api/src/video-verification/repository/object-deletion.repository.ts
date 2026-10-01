import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ObjectDeletionStatus } from '../video-verification.types';

/** A pending tombstone row awaiting MinIO object removal. */
export interface PendingTombstone {
  readonly objectKey: string;
}

/**
 * Object-deletion tombstone repository (`video_verification_object_deletions`).
 *
 * Drains the tombstones a `BEFORE DELETE` trigger writes when a `verification_sessions` row is
 * deleted (direct or via CASCADE from `service_sessions`/`offers`), so the tombstone-drain worker
 * can remove the freed MinIO object even after the owning row is gone. All operations are
 * idempotent and parameterized.
 */
@Injectable()
export class ObjectDeletionRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Select the oldest PENDING tombstones, bounded by `limit`. */
  async findPending(limit: number): Promise<PendingTombstone[]> {
    const rows = await this.dataSource.query<Array<{ object_key: string }>>(
      `SELECT "object_key"
       FROM "video_verification_object_deletions"
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
      `UPDATE "video_verification_object_deletions"
       SET "status" = $1, "processed_at" = NOW()
       WHERE "object_key" = $2`,
      [ObjectDeletionStatus.DONE, objectKey],
    );
  }
}
