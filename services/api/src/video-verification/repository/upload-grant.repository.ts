import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { VIDEO_VERIFICATION_UPLOAD_GRANT_TTL_SECONDS } from '../video-verification.constants';
import { GrantStatus } from '../video-verification.types';

/** Milliseconds per second for expiry math. */
const MS_PER_SECOND = 1000;

/** Parameters to create a fresh (ISSUED) upload grant. */
export interface CreateGrantParams {
  readonly objectKey: string;
  readonly serviceSessionId: string;
  readonly issuedToUserId: string;
}

/** A consumable grant row as read inside the finalize transaction. */
export interface ConsumableGrant {
  readonly objectKey: string;
  readonly serviceSessionId: string;
  readonly issuedToUserId: string | null;
  readonly status: string;
  readonly expiresAt: Date;
}

/** An expired ISSUED grant selected for the orphan-cleanup sweep. */
export interface ExpiredGrant {
  readonly objectKey: string;
}

/**
 * Upload-grant repository (`video_verification_upload_grants`).
 *
 * An object key is a GRANT, never a credential: finalize is accepted only against a grant issued to
 * the authenticated Cleaner for that exact service session, unexpired and unconsumed, and a grant
 * maps to AT MOST one durable verification. Parameterized SQL only; no sensitive content is logged.
 * `findConsumable`/`markConsumed` run inside the caller's finalize transaction (shared
 * `EntityManager`) so grant verification + consumption are atomic with the state transition.
 */
@Injectable()
export class UploadGrantRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Persist a fresh ISSUED grant BEFORE the pre-signed URL is minted, so a URL-minting failure
   * still leaves the (never-uploaded) object's grant recorded for the cleanup sweep.
   */
  async createGrant(params: CreateGrantParams): Promise<void> {
    const expiresAt = new Date(
      Date.now() + VIDEO_VERIFICATION_UPLOAD_GRANT_TTL_SECONDS * MS_PER_SECOND,
    );
    await this.dataSource.query(
      `INSERT INTO "video_verification_upload_grants"
         ("object_key", "service_session_id", "issued_to_user_id", "status", "expires_at")
       VALUES ($1, $2, $3, $4, $5)`,
      [params.objectKey, params.serviceSessionId, params.issuedToUserId, GrantStatus.ISSUED, expiresAt],
    );
  }

  /**
   * Read a grant by its object key inside the finalize transaction (FOR UPDATE). Returns null when
   * no such grant exists. Consumability (issued-to/session/expiry/status) is decided by the caller.
   */
  async findConsumable(manager: EntityManager, objectKey: string): Promise<ConsumableGrant | null> {
    const rows = await manager.query<
      Array<{
        object_key: string;
        service_session_id: string;
        issued_to_user_id: string | null;
        status: string;
        expires_at: Date;
      }>
    >(
      `SELECT "object_key", "service_session_id", "issued_to_user_id", "status", "expires_at"
       FROM "video_verification_upload_grants"
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
      serviceSessionId: row.service_session_id,
      issuedToUserId: row.issued_to_user_id,
      status: row.status,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Mark a grant CONSUMED and record the durable verification that consumed it, within the finalize
   * transaction. A single-use grant transitions ISSUED → CONSUMED exactly once.
   */
  async markConsumed(
    manager: EntityManager,
    objectKey: string,
    verificationId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE "video_verification_upload_grants"
       SET "status" = $1, "consumed_verification_id" = $2
       WHERE "object_key" = $3`,
      [GrantStatus.CONSUMED, verificationId, objectKey],
    );
  }

  /**
   * Select expired, still-ISSUED grants (orphan uploads from abandoned finalize) for the bounded
   * cleanup sweep. Ordered oldest-first.
   */
  async findStaleGrants(now: Date, limit: number): Promise<ExpiredGrant[]> {
    const rows = await this.dataSource.query<Array<{ object_key: string }>>(
      `SELECT "object_key"
       FROM "video_verification_upload_grants"
       WHERE "status" = $1 AND "expires_at" < $2
       ORDER BY "expires_at" ASC
       LIMIT $3`,
      [GrantStatus.ISSUED, now, limit],
    );
    return rows.map((row) => ({ objectKey: row.object_key }));
  }

  /** Delete a grant by object key. Idempotent — a missing row is a no-op. */
  async deleteGrant(objectKey: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM "video_verification_upload_grants" WHERE "object_key" = $1`,
      [objectKey],
    );
  }
}
