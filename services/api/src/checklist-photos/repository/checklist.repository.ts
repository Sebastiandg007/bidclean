import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { OutboxRow, writeOutbox } from '../../common/outbox/outbox-writer';
import { ChecklistRunState, StartedPayload, TaskPhotoKind } from '../checklist.types';

/** A raw run row (snake_case as stored). */
export interface RunRow {
  readonly id: string;
  readonly service_session_id: string;
  readonly offer_id: string;
  readonly property_id: string | null;
  readonly total_tasks: number;
  readonly completed_tasks: number;
  readonly photo_required_policy_snapshot: unknown;
  readonly completion_precondition_snapshot: unknown;
  readonly max_photos_per_task_snapshot: number;
  readonly state: string;
  readonly completed_at: Date | null;
  readonly abandoned_reason: string | null;
}

/** A raw task row (snake_case as stored). */
export interface TaskRow {
  readonly id: string;
  readonly run_id: string;
  readonly position: number;
  readonly task_text: string;
  readonly is_done: boolean;
  readonly completed_at: Date | null;
}

/** A raw photo row (metadata only; never bytes). */
export interface PhotoRow {
  readonly id: string;
  readonly task_id: string;
  readonly run_id: string;
  readonly object_key: string;
  readonly kind: string;
  readonly uploaded_at: Date;
  readonly object_deleted_at: Date | null;
}

/** A photo retention-eligible row (key + id for the retention sweep). */
export interface RetentionPhotoRow {
  readonly id: string;
  readonly objectKey: string;
}

/** Params for inserting a finalized photo (server-authoritative values). */
export interface InsertPhotoParams {
  readonly taskId: string;
  readonly runId: string;
  readonly objectKey: string;
  readonly kind: TaskPhotoKind;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
}

/** The full SELECT list for a run row, kept once so every read returns the same shape. */
const RUN_COLUMNS = `
  "id", "service_session_id", "offer_id", "property_id", "total_tasks", "completed_tasks",
  "photo_required_policy_snapshot", "completion_precondition_snapshot",
  "max_photos_per_task_snapshot", "state", "completed_at", "abandoned_reason"
`;

/**
 * ChecklistRepository (`checklist_runs` + `checklist_tasks` + `checklist_task_photos` +
 * `checklist_outbox`) — parameterized SQL only (Spec 19).
 *
 * The run `FOR UPDATE` lock (`lockRun`) is the single serialization point shared by request-upload,
 * finalize-photo, and finalize-checklist — so per-task slot reservation and the finalize-photo /
 * finalize-checklist races serialize on one lock. Run transitions are single-winner conditional
 * writes (`UPDATE ... WHERE id=:id AND state=:expected`) that set derived fields AND write the
 * `checklist_outbox` row in the SAME transaction. The checklist snapshot is read from the event,
 * never re-read live from the property.
 */
@Injectable()
export class ChecklistRepository {
  constructor(private readonly dataSource: DataSource) {}

  // ─── Creation (idempotent, from the durable event) ────────────────────────────

  /**
   * Idempotent run creation off the `service_started` fact: `INSERT ... ON CONFLICT
   * (service_session_id) DO NOTHING` the run then bulk-insert ordered tasks from the event-carried
   * snapshot. One transaction. A redelivered/concurrent attempt is a no-op (UNIQUE guarantee).
   * Returns true when this call created the run (inserted a row).
   */
  async createRunWithTasks(payload: StartedPayload): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const inserted = await manager.query<Array<{ id: string }>>(
        `INSERT INTO "checklist_runs"
           ("service_session_id", "offer_id", "property_id", "total_tasks", "completed_tasks",
            "photo_required_policy_snapshot", "completion_precondition_snapshot",
            "max_photos_per_task_snapshot", "state")
         VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8)
         ON CONFLICT ("service_session_id") DO NOTHING
         RETURNING "id"`,
        [
          payload.sessionId,
          payload.offerId,
          payload.propertyId,
          payload.checklistItems.length,
          JSON.stringify(payload.photoRequiredPolicy),
          JSON.stringify(payload.completionPrecondition),
          payload.maxPhotosPerTask,
          ChecklistRunState.ACTIVE,
        ],
      );
      const runId = inserted[0]?.id;
      if (!runId) {
        return false;
      }
      await this.bulkInsertTasks(manager, runId, payload.checklistItems);
      return true;
    });
  }

  /** Bulk-insert ordered tasks (`task_text`/`position` preserved). No-op for an empty snapshot. */
  private async bulkInsertTasks(
    manager: EntityManager,
    runId: string,
    items: readonly string[],
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const values: string[] = [];
    const params: unknown[] = [runId];
    items.forEach((text, index) => {
      params.push(index, text);
      values.push(`($1, $${params.length - 1}, $${params.length})`);
    });
    await manager.query(
      `INSERT INTO "checklist_tasks" ("run_id", "position", "task_text")
       VALUES ${values.join(', ')}`,
      params,
    );
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /** Load a run by its (unique) session id. */
  async findRunBySessionId(sessionId: string): Promise<RunRow | null> {
    const rows = await this.dataSource.query<RunRow[]>(
      `SELECT ${RUN_COLUMNS} FROM "checklist_runs" WHERE "service_session_id" = $1 LIMIT 1`,
      [sessionId],
    );
    return rows[0] ?? null;
  }

  /** Load a run by its (denormalized) offer id (offer-terminal path). */
  async findRunByOfferId(offerId: string): Promise<RunRow | null> {
    const rows = await this.dataSource.query<RunRow[]>(
      `SELECT ${RUN_COLUMNS} FROM "checklist_runs" WHERE "offer_id" = $1 LIMIT 1`,
      [offerId],
    );
    return rows[0] ?? null;
  }

  /** Load a task by id (bounded to a run). */
  async findTaskById(taskId: string): Promise<TaskRow | null> {
    const rows = await this.dataSource.query<TaskRow[]>(
      `SELECT "id", "run_id", "position", "task_text", "is_done", "completed_at"
       FROM "checklist_tasks" WHERE "id" = $1 LIMIT 1`,
      [taskId],
    );
    return rows[0] ?? null;
  }

  /** Ordered tasks for a run (reconciliation read). */
  async findTasks(runId: string): Promise<TaskRow[]> {
    return this.dataSource.query<TaskRow[]>(
      `SELECT "id", "run_id", "position", "task_text", "is_done", "completed_at"
       FROM "checklist_tasks" WHERE "run_id" = $1 ORDER BY "position" ASC`,
      [runId],
    );
  }

  /** Photo references for a run's tasks (ids/kind/uploaded_at only — never keys/bytes). */
  async findPhotosForRun(runId: string): Promise<PhotoRow[]> {
    return this.dataSource.query<PhotoRow[]>(
      `SELECT "id", "task_id", "run_id", "object_key", "kind", "uploaded_at", "object_deleted_at"
       FROM "checklist_task_photos" WHERE "run_id" = $1 ORDER BY "uploaded_at" ASC`,
      [runId],
    );
  }

  /**
   * Session-scoped playback lookup: `photo → task → run WHERE run.service_session_id = :sessionId`.
   * A `photoId` that does not belong to `:sessionId` returns null (→ 404, no disclosure). The
   * object key is resolved here from the DB, never a client-supplied value.
   */
  async findPhotoScopedToSession(
    photoId: string,
    sessionId: string,
  ): Promise<{ objectKey: string; objectDeletedAt: Date | null } | null> {
    const rows = await this.dataSource.query<
      Array<{ object_key: string; object_deleted_at: Date | null }>
    >(
      `SELECT p."object_key", p."object_deleted_at"
       FROM "checklist_task_photos" p
       INNER JOIN "checklist_runs" r ON r."id" = p."run_id"
       WHERE p."id" = $1 AND r."service_session_id" = $2
       LIMIT 1`,
      [photoId, sessionId],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return { objectKey: row.object_key, objectDeletedAt: row.object_deleted_at };
  }

  /** Count committed photos for a task (used under the run lock for the cap check). */
  async countPhotosForTask(manager: EntityManager, taskId: string): Promise<number> {
    const rows = await manager.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::int AS count FROM "checklist_task_photos" WHERE "task_id" = $1`,
      [taskId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Total committed photo count for a run (finalize summary, under the run lock). */
  async countPhotosForRun(manager: EntityManager, runId: string): Promise<number> {
    const rows = await manager.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::int AS count FROM "checklist_task_photos" WHERE "run_id" = $1`,
      [runId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  // ─── The run lock (single serialization point) ────────────────────────────────

  /** `SELECT ... FOR UPDATE` on the run row — shared by request-upload, finalize-photo, finalize. */
  async lockRun(manager: EntityManager, runId: string): Promise<RunRow | null> {
    const rows = await manager.query<RunRow[]>(
      `SELECT ${RUN_COLUMNS} FROM "checklist_runs" WHERE "id" = $1 FOR UPDATE`,
      [runId],
    );
    return rows[0] ?? null;
  }

  // ─── Mutations ───────────────────────────────────────────────────────────────

  /**
   * The count-invariant task write under the run lock: set `is_done`/`completed_at` on the task
   * then recompute `completed_tasks = COUNT(is_done=true)` for the run. Idempotent per final state.
   * The caller must hold the run lock (`lockRun`) in `manager` so no concurrent mutation of another
   * task in the run loses an update.
   */
  async markTaskAtomic(
    manager: EntityManager,
    runId: string,
    taskId: string,
    done: boolean,
  ): Promise<void> {
    await manager.query(
      `UPDATE "checklist_tasks"
       SET "is_done" = $1,
           "completed_at" = CASE WHEN $1 THEN COALESCE("completed_at", NOW()) ELSE NULL END,
           "updated_at" = NOW()
       WHERE "id" = $2 AND "run_id" = $3`,
      [done, taskId, runId],
    );
    await manager.query(
      `UPDATE "checklist_runs"
       SET "completed_tasks" = (
             SELECT COUNT(*)::int FROM "checklist_tasks"
             WHERE "run_id" = $1 AND "is_done" = true
           ),
           "updated_at" = NOW()
       WHERE "id" = $1`,
      [runId],
    );
  }

  /** Insert a finalized photo (server-authoritative values), returning its id. Under the run lock. */
  async insertPhoto(manager: EntityManager, params: InsertPhotoParams): Promise<string> {
    const rows = await manager.query<Array<{ id: string }>>(
      `INSERT INTO "checklist_task_photos"
         ("task_id", "run_id", "object_key", "kind", "size_bytes", "mime_type", "width", "height")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING "id"`,
      [
        params.taskId,
        params.runId,
        params.objectKey,
        params.kind,
        params.sizeBytes,
        params.mimeType,
        params.width,
        params.height,
      ],
    );
    const id = rows[0]?.id;
    if (!id) {
      throw new Error('Photo insert returned no id');
    }
    return id;
  }

  /**
   * Single-winner run transition: `UPDATE ... WHERE id=:id AND state='ACTIVE'` sets the derived
   * fields AND (for COMPLETED) writes the `checklist_outbox` row in ONE transaction. Returns true
   * for the winner (rows=1), false for a loser (already terminal → no-op). The caller runs this
   * inside a transaction that already holds `lockRun` when serialization with photo-finalize matters.
   */
  async transitionRun(
    manager: EntityManager,
    runId: string,
    next: ChecklistRunState,
    derived: { completedAt?: boolean; abandonedReason?: string },
    outbox: OutboxRow | null,
  ): Promise<boolean> {
    const rows = await manager.query<Array<{ id: string }>>(
      `UPDATE "checklist_runs"
       SET "state" = $2,
           "completed_at" = CASE WHEN $3 THEN COALESCE("completed_at", NOW()) ELSE "completed_at" END,
           "abandoned_reason" = COALESCE($4, "abandoned_reason"),
           "updated_at" = NOW()
       WHERE "id" = $1 AND "state" = $5
       RETURNING "id"`,
      [
        runId,
        next,
        derived.completedAt === true,
        derived.abandonedReason ?? null,
        ChecklistRunState.ACTIVE,
      ],
    );
    if (!rows[0]) {
      return false;
    }
    if (outbox) {
      await writeOutbox(manager, outbox);
    }
    return true;
  }

  /** Run a callback inside a transaction (used by services that need the run lock). */
  async withTransaction<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(fn);
  }

  // ─── Sweep / retention scans ──────────────────────────────────────────────────

  /** Photos older than `before` (by `uploaded_at`) whose object is not yet deleted. Oldest-first. */
  async findRetentionEligible(before: Date, limit: number): Promise<RetentionPhotoRow[]> {
    const rows = await this.dataSource.query<Array<{ id: string; object_key: string }>>(
      `SELECT "id", "object_key"
       FROM "checklist_task_photos"
       WHERE "object_deleted_at" IS NULL AND "uploaded_at" < $1
       ORDER BY "uploaded_at" ASC
       LIMIT $2`,
      [before, limit],
    );
    return rows.map((row) => ({ id: row.id, objectKey: row.object_key }));
  }

  /** Mark a photo's bytes hard-deleted (retention/tombstone); metadata retained. Set once. */
  async markObjectDeleted(photoId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "checklist_task_photos"
       SET "object_deleted_at" = NOW()
       WHERE "id" = $1 AND "object_deleted_at" IS NULL`,
      [photoId],
    );
  }

  /**
   * ACTIVE runs whose parent session is already terminal-for-tracking (a missed terminal signal),
   * created before `before`. Oldest-first, bounded (stuck-run sweep input).
   */
  async findStaleActiveRuns(before: Date, limit: number): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT r."id"
       FROM "checklist_runs" r
       INNER JOIN "service_sessions" s ON s."id" = r."service_session_id"
       WHERE r."state" = $1
         AND s."state" IN ('IN_PROGRESS', 'CANCELED', 'EXPIRED')
         AND s."state" <> 'IN_PROGRESS'
         AND r."updated_at" < $2
       ORDER BY r."updated_at" ASC
       LIMIT $3`,
      [ChecklistRunState.ACTIVE, before, limit],
    );
    return rows.map((row) => row.id);
  }

  // ─── Cross-module read-only resolution (payments precedent) ───────────────────

  /**
   * Resolve a session's participants (`host_id`/`cleaner_id`) read-only. The single source of the
   * participation rule for every checklist endpoint; a nulled participant (after user deletion)
   * resolves to a null id, so that id is a non-participant while the row is retained. Returns null
   * when the session is unknown.
   */
  async findSessionParticipants(
    sessionId: string,
  ): Promise<{ hostId: string | null; cleanerId: string | null; state: string } | null> {
    const rows = await this.dataSource.query<
      Array<{ host_id: string | null; cleaner_id: string | null; state: string }>
    >(
      `SELECT "host_id", "cleaner_id", "state" FROM "service_sessions" WHERE "id" = $1 LIMIT 1`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return { hostId: row.host_id, cleanerId: row.cleaner_id, state: row.state };
  }

  /**
   * Resolve the property's `checklistItems` read-only (never writes properties). Used as a fallback
   * when the event does not carry the snapshot; the event-carried snapshot is preferred so the run
   * stays temporally exact. Returns null when the property is missing/unresolvable.
   */
  async resolveChecklistItems(propertyId: string): Promise<string[] | null> {
    const rows = await this.dataSource.query<Array<{ checklist_items: string[] }>>(
      `SELECT "checklist_items" FROM "properties" WHERE "id" = $1 LIMIT 1`,
      [propertyId],
    );
    return rows[0]?.checklist_items ?? null;
  }
}
