import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the voip-calls table — `voip_calls` (Spec 15).
 *
 * A call is a durable record THAT a call happened between the two participants of a Spec 13
 * `chat_conversations` row; it is NOT the media. PostgreSQL is the source of truth for the call
 * as an event + its lifecycle; LiveKit is the source of truth for the live media (an ephemeral
 * room referenced only by the opaque `room_name`); Centrifugo is best-effort signaling. Media
 * bytes never transit the API or PostgreSQL, so there is no media column.
 *
 * FK / deletion policy (deliberate — inherits the Spec 13 invariant, migration 1700000019000):
 * - `conversation_id` / `offer_id` → ON DELETE CASCADE: a call is meaningless without its parent
 *   conversation/offer, so removing the parent removes the call. NEVER a user-cascade path.
 * - `initiator_id` / `callee_id` → ON DELETE SET NULL: deleting/anonymizing a participant nulls
 *   the identity but keeps the shared conversation's call history (deletion coherence, REQ-VP10).
 *
 * State machine: RINGING -> { ONGOING -> ENDED } | MISSED | DECLINED | CANCELED | FAILED. Terminal
 * statuses are immutable audit facts — there is intentionally NO `deleted_at`; only lifecycle
 * fields mutate while non-terminal.
 *
 * Key constraints:
 * - `uq_voip_calls_room (room_name)` — a room name is opaque, unique, and never reused across calls.
 * - `uq_voip_one_active_per_conversation` — partial UNIQUE on `(conversation_id)` WHERE status is
 *   non-terminal — the HARD guarantee behind "at most one active call per conversation".
 * - `uq_voip_client_call (conversation_id, initiator_id, client_call_id)` WHERE initiator_id IS NOT
 *   NULL — idempotent initiate scoped to the initiator (a nulled historical row drops out).
 * - `idx_voip_calls_conversation (conversation_id, initiated_at DESC)` — call history reads.
 * - `idx_voip_ring_sweep` / `idx_voip_stale_sweep` — bounded, partial sweep scans.
 */
export class CreateVoipCallsTable1700000040000 implements MigrationInterface {
  name = 'CreateVoipCallsTable1700000040000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "voip_calls" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- The conversation this call belongs to; participants + OPEN-lifecycle come from it
        "conversation_id" UUID NOT NULL,
        -- Denormalized from the conversation for offer-terminal lifecycle coherence
        "offer_id" UUID NOT NULL,

        -- Participants; nullable so a deleted/anonymized user does not destroy call history
        "initiator_id" UUID,
        "callee_id" UUID,

        -- AUDIO (default) | VIDEO (optional, capability-gated)
        "media_kind" VARCHAR(10) NOT NULL DEFAULT 'AUDIO',

        -- Opaque LiveKit room id; unique, never reused across calls; NOT a credential
        "room_name" VARCHAR(128) NOT NULL,

        -- Lifecycle: non-terminal = RINGING|ONGOING; terminal = the rest (immutable)
        "status" VARCHAR(12) NOT NULL DEFAULT 'RINGING',

        -- Nullable until a terminal transition sets it
        "end_reason" VARCHAR(24),

        -- Initiator-generated; makes initiate idempotent (scoped with initiator_id below)
        "client_call_id" VARCHAR(64) NOT NULL,

        "initiated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        -- Set on RINGING -> ONGOING
        "answered_at" TIMESTAMP WITH TIME ZONE,
        -- Set on any terminal transition
        "ended_at" TIMESTAMP WITH TIME ZONE,
        -- Updated by the signed LiveKit webhook; drives the stale-call sweep
        "last_media_activity_at" TIMESTAMP WITH TIME ZONE,
        -- Derived on end: ended_at - answered_at (0/NULL when never answered)
        "duration_seconds" INTEGER,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "fk_voip_calls_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_voip_calls_offer"
          FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_voip_calls_initiator"
          FOREIGN KEY ("initiator_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_voip_calls_callee"
          FOREIGN KEY ("callee_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "uq_voip_calls_room" UNIQUE ("room_name"),
        CONSTRAINT "chk_voip_calls_media_kind" CHECK ("media_kind" IN ('AUDIO', 'VIDEO')),
        CONSTRAINT "chk_voip_calls_status" CHECK (
          "status" IN ('RINGING', 'ONGOING', 'ENDED', 'MISSED', 'DECLINED', 'CANCELED', 'FAILED')
        ),
        CONSTRAINT "chk_voip_calls_end_reason" CHECK (
          "end_reason" IS NULL OR "end_reason" IN (
            'HANGUP', 'DECLINED', 'CANCELED', 'TIMEOUT_NO_ANSWER', 'TIMEOUT',
            'CONVERSATION_CLOSED', 'ERROR'
          )
        )
      )
    `);

    // At most one non-terminal (RINGING|ONGOING) call per conversation — the hard guarantee.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_voip_one_active_per_conversation"
        ON "voip_calls" ("conversation_id")
        WHERE "status" IN ('RINGING', 'ONGOING')
    `);

    // Idempotent initiate scoped to the initiator; a nulled historical row drops out.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_voip_client_call"
        ON "voip_calls" ("conversation_id", "initiator_id", "client_call_id")
        WHERE "initiator_id" IS NOT NULL
    `);

    // Call history reads (most recent first).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voip_calls_conversation"
        ON "voip_calls" ("conversation_id", "initiated_at" DESC)
    `);

    // FK indexes (PostgreSQL does not auto-index FK columns).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voip_calls_offer"
        ON "voip_calls" ("offer_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voip_calls_initiator"
        ON "voip_calls" ("initiator_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voip_calls_callee"
        ON "voip_calls" ("callee_id")
    `);

    // Bounded, partial sweep scans.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voip_ring_sweep"
        ON "voip_calls" ("status", "initiated_at")
        WHERE "status" = 'RINGING'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voip_stale_sweep"
        ON "voip_calls" ("status", "last_media_activity_at")
        WHERE "status" = 'ONGOING'
    `);

    // Table + column comments (documentation standards).
    await queryRunner.query(
      `COMMENT ON TABLE "voip_calls" IS 'Durable record that a live voice/video call happened between the two participants of a chat conversation; never holds media (LiveKit owns the media session).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "voip_calls"."room_name" IS 'Opaque LiveKit room id; unique, never reused, never a credential.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "voip_calls"."status" IS 'RINGING|ONGOING (non-terminal) or ENDED|MISSED|DECLINED|CANCELED|FAILED (terminal, immutable).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "voip_calls"."last_media_activity_at" IS 'Updated by the signed LiveKit webhook (server-authoritative liveness); drives the stale-call sweep.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "voip_calls"."duration_seconds" IS 'Derived on end: ended_at - answered_at; 0/NULL when never answered.'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_voip_stale_sweep"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_voip_ring_sweep"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_voip_calls_callee"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_voip_calls_initiator"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_voip_calls_offer"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_voip_calls_conversation"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_voip_client_call"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_voip_one_active_per_conversation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "voip_calls"`);
  }
}
