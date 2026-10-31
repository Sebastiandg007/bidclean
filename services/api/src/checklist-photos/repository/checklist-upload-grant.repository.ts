import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { CHECKLIST_PHOTO_UPLOAD_GRANT_TTL_SECONDS } from '../checklist.constants';
import { GrantStatus } from '../checklist.types';

/** Milliseconds per second for expiry math. */
const MS_PER_SECOND = 1000;

/** Parameters to create a fresh (ISSUED) upload grant, under the run lock. */
export interface CreateGrantParams {
  readonly objectKey: string;
  readonly runId: string;
  readonly taskId: string;
  readonly issuedToUserId: string;
}

/** A consumable grant row as read inside the finalize transaction. */
export interface ConsumableGrant {
  readonly objectKey: string;
  readonly runId: string;
  readonly taskId: string;
  readonly issuedToUserId: string | null;
  readonly status: string;
  readonly expiresAt: Date;
}

/** A stale ISSUED grant selected for the orphan-cleanup sweep. */
export interface StaleGrant {
  readonly objectKey: string;
}

/**
 * Checklist upload-grant repository (`checklist_upload_grants`).
 *
 * An object key is a GRANT, never a credential: a finalize is accepted only against a grant issued
 * to the authenticated Cleaner for that exact run/task, unexpired and unconsumed. Parameterized SQL
 * only; no object key is logged. `countActiveGrantsForTask`/`createGrant` run under the run lock
 * (shared `EntityManager`) so a slot reservation is atomic; `findConsumable`/`markConsumed` run
 * inside the finalize transaction so grant verification + consumption are atomic with the insert.
 */
@Injectable()
export class ChecklistUploadGrantRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Persist a fresh ISSUED grant BEFORE the pre-signed URL is minted (under the run lock, reserving
   * a slot), so a URL-minting failure still leaves the recorded grant for the cleanup sweep.
   */
  async createGrant(manager: EntityManager, params: CreateGrantParams): Promise<void> {
    const expiresAt = new Date(Date.now() + CHECKLIST_PHOTO_UPLOAD_GRANT_TTL_SECONDS * MS_PER_SECOND);
    await manager.query(
      `INSERT INTO "checklist_upload_grants"
         ("object_key", "run_id", "task_id", "issued_to_user_id", "status", "expires_at")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [params.objectKey, params.runId, params.taskId, params.issuedToUserId, GrantStatus.ISSUED, expiresAt],
    );
  }

  /**
   * Count ISSUED + unexpired grants for a task (the reserved slots). Runs under the run lock as part
   * of the atomic per-task slot reservation (`committed_photos + active_grants < max`).
   */
  async countActiveGrantsForTask(
    manager: EntityManager,
    taskId: string,
    now: Date,
  ): Promise<number> {
    const rows = await manager.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::int AS count
       FROM "checklist_upload_grants"
       WHERE "task_id" = $1 AND "status" = $2 AND "expires_at" > $3`,
      [taskId, GrantStatus.ISSUED, now],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Read a grant by its object key inside the finalize transaction (row-locked). Returns null when
   * no such grant exists. Consumability (issued-to/run/task/expiry/status) is decided by the caller.
   */
  async findConsumable(manager: EntityManager, objectKey: string): Promise<ConsumableGrant | null> {
    const rows = await manager.query<
      Array<{
        object_key: string;
        run_id: string;
        task_id: string;
        issued_to_user_id: string | null;
        status: string;
        expires_at: Date;
      }>
    >(
      `SELECT "object_key", "run_id", "task_id", "issued_to_user_id", "status", "expires_at"
       FROM "checklist_upload_grants"
       WHERE "object_key" = $1
       FOR UPDATE`,
      [objectKey],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      objectKey: row.object_key,
      runId: row.run_id,
      taskId: row.task_id,
      issuedToUserId: row.issued_to_user_id,
      status: row.status,
      expiresAt: row.expires_at,
    };
  }

  /** Mark a grant CONSUMED and record the photo that consumed it, within the finalize transaction. */
  async markConsumed(
    manager: EntityManager,
    objectKey: string,
    photoId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE "checklist_upload_grants"
       SET "status" = $1, "consumed_photo_id" = $2
       WHERE "object_key" = $3`,
      [GrantStatus.CONSUMED, photoId, objectKey],
    );
  }

  /**
   * Select expired, still-ISSUED grants (orphan uploads from abandoned/failed finalizes) for the
   * bounded stale-grant cleanup sweep. Ordered oldest-first.
   */
  async findStaleGrants(now: Date, limit: number): Promise<StaleGrant[]> {
    const rows = await this.dataSource.query<Array<{ object_key: string }>>(
      `SELECT "object_key"
       FROM "checklist_upload_grants"
       WHERE "status" = $1 AND "expires_at" < $2
       ORDER BY "expires_at" ASC
       LIMIT $3`,
      [GrantStatus.ISSUED, now, limit],
    );
    return rows.map((row) => ({ objectKey: row.object_key }));
  }

  /**
   * Transition a grant ISSUED → EXPIRED/CANCELLED (called by the stale-grant sweep after the
   * orphan object is deleted, so a swept grant is no longer eternally ISSUED). Idempotent — only an
   * ISSUED grant is closed.
   */
  async markClosed(objectKey: string, status: GrantStatus): Promise<void> {
    await this.dataSource.query(
      `UPDATE "checklist_upload_grants"
       SET "status" = $1
       WHERE "object_key" = $2 AND "status" = $3`,
      [status, objectKey, GrantStatus.ISSUED],
    );
  }
}
