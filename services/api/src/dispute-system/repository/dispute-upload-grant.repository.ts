import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { DISPUTE_EVIDENCE_UPLOAD_GRANT_TTL_SECONDS } from '../dispute.constants';
import { GrantStatus } from '../dispute.types';

/** Milliseconds per second for expiry math. */
const MS_PER_SECOND = 1000;

/** A consumable grant row as read inside the finalize transaction. */
export interface ConsumableGrant {
  readonly objectKey: string;
  readonly disputeId: string;
  readonly issuedToUserId: string | null;
  readonly status: string;
  readonly expiresAt: Date;
}

/** A stale ISSUED grant selected for the orphan-cleanup sweep. */
export interface StaleGrant {
  readonly objectKey: string;
}

/**
 * DisputeUploadGrantRepository (`dispute_upload_grants`) — parameterized SQL only (Spec 21).
 *
 * An object key is a GRANT, never a credential: a finalize is accepted only against a grant issued
 * to the authenticated participant for that exact dispute, unexpired and unconsumed. `createGrant`
 * persists the grant BEFORE the pre-signed URL is minted; `findConsumable`/`markConsumed` run inside
 * the finalize transaction so grant verification + consumption are atomic with the evidence insert.
 * No object key is logged.
 */
@Injectable()
export class DisputeUploadGrantRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Persist a fresh ISSUED grant BEFORE the pre-signed URL is minted (reserving a slot). */
  async createGrant(objectKey: string, disputeId: string, issuedToUserId: string): Promise<void> {
    const expiresAt = new Date(Date.now() + DISPUTE_EVIDENCE_UPLOAD_GRANT_TTL_SECONDS * MS_PER_SECOND);
    await this.dataSource.query(
      `INSERT INTO "dispute_upload_grants"
         ("object_key", "dispute_id", "issued_to_user_id", "status", "expires_at")
       VALUES ($1, $2, $3, $4, $5)`,
      [objectKey, disputeId, issuedToUserId, GrantStatus.ISSUED, expiresAt],
    );
  }

  /** Count ISSUED + unexpired grants for a dispute (reserved slots for the per-dispute cap). */
  async countActiveGrants(disputeId: string, now: Date): Promise<number> {
    const rows = await this.dataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::int AS count
       FROM "dispute_upload_grants"
       WHERE "dispute_id" = $1 AND "status" = $2 AND "expires_at" > $3`,
      [disputeId, GrantStatus.ISSUED, now],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Read a grant by key inside the finalize transaction (row-locked). Null when none exists. */
  async findConsumable(manager: EntityManager, objectKey: string): Promise<ConsumableGrant | null> {
    const rows = await manager.query<
      Array<{
        object_key: string;
        dispute_id: string;
        issued_to_user_id: string | null;
        status: string;
        expires_at: Date;
      }>
    >(
      `SELECT "object_key", "dispute_id", "issued_to_user_id", "status", "expires_at"
       FROM "dispute_upload_grants" WHERE "object_key" = $1 FOR UPDATE`,
      [objectKey],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      objectKey: row.object_key,
      disputeId: row.dispute_id,
      issuedToUserId: row.issued_to_user_id,
      status: row.status,
      expiresAt: row.expires_at,
    };
  }

  /** Mark a grant CONSUMED and record the evidence that consumed it, within the finalize tx. */
  async markConsumed(manager: EntityManager, objectKey: string, evidenceId: string): Promise<void> {
    await manager.query(
      `UPDATE "dispute_upload_grants"
       SET "status" = $1, "consumed_evidence_id" = $2
       WHERE "object_key" = $3`,
      [GrantStatus.CONSUMED, evidenceId, objectKey],
    );
  }

  /** Select expired, still-ISSUED grants (orphan uploads) for the bounded stale-grant sweep. */
  async findStaleGrants(now: Date, limit: number): Promise<StaleGrant[]> {
    const rows = await this.dataSource.query<Array<{ object_key: string }>>(
      `SELECT "object_key"
       FROM "dispute_upload_grants"
       WHERE "status" = $1 AND "expires_at" < $2
       ORDER BY "expires_at" ASC
       LIMIT $3`,
      [GrantStatus.ISSUED, now, limit],
    );
    return rows.map((row) => ({ objectKey: row.object_key }));
  }

  /** Transition a grant ISSUED → EXPIRED/CANCELLED (after the orphan object is deleted). Idempotent. */
  async markClosed(objectKey: string, status: GrantStatus): Promise<void> {
    await this.dataSource.query(
      `UPDATE "dispute_upload_grants"
       SET "status" = $1
       WHERE "object_key" = $2 AND "status" = $3`,
      [status, objectKey, GrantStatus.ISSUED],
    );
  }
}
