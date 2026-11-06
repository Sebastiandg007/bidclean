import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ObjectDeletionStatus } from './voice.types';

/** A pending tombstone row awaiting MinIO object removal. */
export interface PendingTombstone {
  readonly id: string;
  readonly objectKey: string;
}

/**
 * Object-deletion tombstone repository (`voice_note_object_deletions`).
 *
 * Drains the tombstones a `BEFORE DELETE` trigger writes when a `chat_voice_notes` row is deleted
 * (direct or via CASCADE), so the cleanup worker can remove the freed MinIO object even after the
 * metadata row is gone. All operations are idempotent and parameterized.
 */
@Injectable()
export class ObjectDeletionRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Select the oldest PENDING tombstones, bounded by `limit`. */
  async findPending(limit: number): Promise<PendingTombstone[]> {
    const rows = await this.dataSource.query<Array<{ id: string; object_key: string }>>(
      `SELECT "id", "object_key"
       FROM "voice_note_object_deletions"
       WHERE "status" = $1
       ORDER BY "created_at" ASC
       LIMIT $2`,
      [ObjectDeletionStatus.PENDING, limit],
    );
    return rows.map((row) => ({ id: row.id, objectKey: row.object_key }));
  }

  /** Mark a tombstone DONE once its MinIO object has been removed. Idempotent. */
  async markDone(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "voice_note_object_deletions"
       SET "status" = $1, "deleted_at" = NOW()
       WHERE "id" = $2`,
      [ObjectDeletionStatus.DONE, id],
    );
  }

  /** Whether a PENDING tombstone exists for an object key (reconciler backstop input). */
  async existsPendingForObject(objectKey: string): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ exists: boolean }>>(
      `SELECT EXISTS (
         SELECT 1 FROM "voice_note_object_deletions"
         WHERE "object_key" = $1 AND "status" = $2
       ) AS exists`,
      [objectKey, ObjectDeletionStatus.PENDING],
    );
    return rows[0]?.exists === true;
  }
}