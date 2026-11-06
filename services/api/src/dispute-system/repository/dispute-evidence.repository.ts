import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { DisputeEvidenceKind, TERMINAL_DISPUTE_STATES } from '../dispute.types';

/** A raw evidence row (snake_case as stored). */
export interface EvidenceRow {
  readonly id: string;
  readonly dispute_id: string;
  readonly submitted_by: string | null;
  readonly kind: string;
  readonly object_key: string | null;
  readonly ref: string | null;
  readonly text_value: string | null;
  readonly object_deleted_at: Date | null;
  readonly created_at: Date;
}

/** Params to insert a HOST_PHOTO evidence row (server-observed metadata). */
export interface InsertHostPhotoParams {
  readonly disputeId: string;
  readonly submittedBy: string;
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

/** Params to insert a structured evidence row (HOST_REASON/NOTE). */
export interface InsertStructuredParams {
  readonly disputeId: string;
  readonly submittedBy: string;
  readonly kind: DisputeEvidenceKind;
  readonly textValue: string;
}

/** Params to insert a typed upstream reference (CHECKLIST_REF/VERIFICATION_REF/ARRIVAL_REF/...). */
export interface InsertReferenceParams {
  readonly disputeId: string;
  readonly kind: DisputeEvidenceKind;
  readonly ref: string | null;
}

/** A retention-deletable evidence object (of a TERMINAL dispute, past the horizon). */
export interface RetentionDeletableRow {
  readonly evidenceId: string;
  readonly objectKey: string;
}

/**
 * DisputeEvidenceRepository (`dispute_evidence`) — parameterized SQL only (Spec 21).
 *
 * Inserts typed upstream references + Host/Cleaner submissions; resolves evidence for reads;
 * feeds the retention job with objects of TERMINAL disputes past the horizon ONLY (evidence for a
 * non-terminal dispute is never deletable). Never copies bytes.
 */
@Injectable()
export class DisputeEvidenceRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Insert a typed upstream reference row (used at creation, inside the opening tx). */
  async insertReference(manager: EntityManager, params: InsertReferenceParams): Promise<void> {
    await manager.query(
      `INSERT INTO "dispute_evidence" ("dispute_id", "kind", "ref") VALUES ($1, $2, $3)`,
      [params.disputeId, params.kind, params.ref],
    );
  }

  /** Insert a structured Host/Cleaner submission (HOST_REASON/NOTE) within the window. */
  async insertStructured(params: InsertStructuredParams): Promise<string> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `INSERT INTO "dispute_evidence" ("dispute_id", "submitted_by", "kind", "text_value")
       VALUES ($1, $2, $3, $4)
       RETURNING "id"`,
      [params.disputeId, params.submittedBy, params.kind, params.textValue],
    );
    return requireId(rows[0]);
  }

  /** Insert a finalized HOST_PHOTO row (inside the finalize tx). Returns the new evidence id. */
  async insertHostPhoto(manager: EntityManager, params: InsertHostPhotoParams): Promise<string> {
    const rows = await manager.query<Array<{ id: string }>>(
      `INSERT INTO "dispute_evidence"
         ("dispute_id", "submitted_by", "kind", "object_key", "size_bytes", "mime_type", "uploaded_at")
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING "id"`,
      [
        params.disputeId,
        params.submittedBy,
        DisputeEvidenceKind.HOST_PHOTO,
        params.objectKey,
        params.sizeBytes,
        params.mimeType,
      ],
    );
    return requireId(rows[0]);
  }

  /** Count Host/Cleaner photos already committed for a dispute (per-dispute cap). */
  async countHostPhotos(disputeId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::int AS count FROM "dispute_evidence"
       WHERE "dispute_id" = $1 AND "kind" = $2`,
      [disputeId, DisputeEvidenceKind.HOST_PHOTO],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** All evidence rows for a dispute (for the view). */
  async findByDispute(disputeId: string): Promise<EvidenceRow[]> {
    return this.dataSource.query<EvidenceRow[]>(
      `SELECT "id", "dispute_id", "submitted_by", "kind", "object_key", "ref", "text_value",
              "object_deleted_at", "created_at"
       FROM "dispute_evidence" WHERE "dispute_id" = $1 ORDER BY "created_at" ASC`,
      [disputeId],
    );
  }

  /** One evidence row scoped to a dispute (playback/read path). */
  async findByIdForDispute(evidenceId: string, disputeId: string): Promise<EvidenceRow | null> {
    const rows = await this.dataSource.query<EvidenceRow[]>(
      `SELECT "id", "dispute_id", "submitted_by", "kind", "object_key", "ref", "text_value",
              "object_deleted_at", "created_at"
       FROM "dispute_evidence" WHERE "id" = $1 AND "dispute_id" = $2 LIMIT 1`,
      [evidenceId, disputeId],
    );
    return rows[0] ?? null;
  }

  /**
   * Retention-deletable objects: HOST_PHOTO objects still present whose dispute is TERMINAL and whose
   * `uploaded_at` is older than the horizon. A non-terminal dispute's evidence is NEVER selected.
   */
  async findRetentionDeletable(before: Date, limit: number): Promise<RetentionDeletableRow[]> {
    const rows = await this.dataSource.query<Array<{ id: string; object_key: string }>>(
      `SELECT e."id", e."object_key"
       FROM "dispute_evidence" e
       INNER JOIN "disputes" d ON d."id" = e."dispute_id"
       WHERE e."object_key" IS NOT NULL
         AND e."object_deleted_at" IS NULL
         AND e."uploaded_at" IS NOT NULL
         AND e."uploaded_at" < $1
         AND d."state" = ANY($2)
       ORDER BY e."uploaded_at" ASC
       LIMIT $3`,
      [before, [...TERMINAL_DISPUTE_STATES], limit],
    );
    return rows.map((row) => ({ evidenceId: row.id, objectKey: row.object_key }));
  }

  /** Mark a HOST_PHOTO object hard-deleted (metadata retained). Idempotent. */
  async markObjectDeleted(evidenceId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "dispute_evidence"
       SET "object_deleted_at" = NOW()
       WHERE "id" = $1 AND "object_deleted_at" IS NULL`,
      [evidenceId],
    );
  }
}

/** Require an inserted id (defensive: RETURNING always yields one row on a successful insert). */
function requireId(row: { id: string } | undefined): string {
  if (!row) {
    throw new Error('Insert did not return an id');
  }
  return row.id;
}
