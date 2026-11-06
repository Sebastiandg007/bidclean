import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * voice-notes schema (Spec 14) — extends `chat_messages` and adds the audio-metadata,
 * upload-grant, and deletion-tombstone tables.
 *
 * A voice note is NOT a new domain: it is a `chat_messages` row with `type = 'VOICE'` whose
 * durable text `body` is replaced by a reference (opaque object key + metadata) to an audio
 * object in MinIO. This migration therefore:
 *
 * (a) Extends `chat_messages`: replaces `chk_chat_message_type` to allow `'VOICE'`, makes `body`
 *     nullable, and adds a shape check (`TEXT` ⇒ body NOT NULL; `VOICE` ⇒ body NULL) so a VOICE
 *     message can never carry a text body and a TEXT message can never be bodiless.
 *
 * (b) `chat_voice_notes` — 1:1 with a VOICE message. Holds the opaque `object_key` (UNIQUE) and
 *     the SERVER-OBSERVED audio metadata plus the derived (never authoritative) transcript
 *     fields. FK to `chat_messages` is UNIQUE + ON DELETE CASCADE. There is intentionally NO
 *     `deleted_at` — audio is immutable; only the transcript fields mutate.
 *
 * (c) `voice_note_upload_grants` — an object key is a GRANT, not a credential. Binds a
 *     server-generated `object_key` (PK) to a conversation + the issuing user, single-use, with
 *     an expiry. `conversation_id` CASCADEs; `issued_to_user_id` / `consumed_message_id` are
 *     ON DELETE SET NULL (deletion coherence — deleting a user never destroys shared history).
 *
 * (d) `voice_note_object_deletions` — a deletion tombstone. A `BEFORE DELETE` trigger on
 *     `chat_voice_notes` copies the freed `object_key` here IN THE SAME TRANSACTION as the delete
 *     (direct or CASCADE up message → conversation → thread → offer), so the cleanup worker can
 *     delete the MinIO object even after the metadata row is gone. Object deletion is always
 *     eventual/idempotent — never a synchronous cross-system DELETE inside the DB transaction.
 *
 * Deletion coherence relies on the Spec 13 invariant (migration 1700000019000) that
 * `chat_messages.sender_id` and `chat_conversations.host_id/cleaner_id` are ON DELETE SET NULL,
 * never CASCADE-from-`users`. Voice notes add no user-cascade path.
 */
export class CreateVoiceNoteTables1700000023000 implements MigrationInterface {
  name = 'CreateVoiceNoteTables1700000023000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // (a) Extend chat_messages: allow VOICE, make body nullable, enforce the type/body shape.
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP CONSTRAINT IF EXISTS "chk_chat_message_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages" ALTER COLUMN "body" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages"
         ADD CONSTRAINT "chk_chat_message_type" CHECK ("type" IN ('TEXT', 'VOICE'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages"
         ADD CONSTRAINT "chk_chat_message_body_shape" CHECK (
           ("type" = 'TEXT' AND "body" IS NOT NULL) OR
           ("type" = 'VOICE' AND "body" IS NULL)
         )`,
    );

    // (b) chat_voice_notes — 1:1 audio metadata for a VOICE message (never the bytes).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_voice_notes" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- 1:1 with a VOICE chat_messages row; cascades when the message is removed
        "message_id" UUID NOT NULL,

        -- Opaque, unguessable MinIO key in the chat-voice-notes bucket
        "object_key" VARCHAR(512) NOT NULL,

        -- Server-observed authoritative metadata (client-declared values are advisory only)
        "duration_ms" INTEGER NOT NULL,
        "size_bytes" INTEGER NOT NULL,
        "mime_type" VARCHAR(64) NOT NULL,

        -- Optional small amplitude array for the player's visual (not the audio)
        "waveform" JSONB,

        -- Derived, best-effort transcript (never authoritative, never logged verbatim)
        "transcript" TEXT,
        "transcript_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "transcript_lang" VARCHAR(35),
        -- Monotonic per-note attempt counter; guards against stale (older-attempt) overwrites
        "transcript_attempt" INTEGER NOT NULL DEFAULT 0,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "uq_chat_voice_notes_message" UNIQUE ("message_id"),
        CONSTRAINT "uq_chat_voice_notes_object" UNIQUE ("object_key"),
        CONSTRAINT "fk_chat_voice_notes_message"
          FOREIGN KEY ("message_id") REFERENCES "chat_messages" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_chat_voice_notes_transcript_status"
          CHECK ("transcript_status" IN ('PENDING', 'READY', 'FAILED', 'DISABLED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_chat_voice_notes_status_updated"
        ON "chat_voice_notes" ("transcript_status", "updated_at")
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "chat_voice_notes" IS
        'Audio metadata for a VOICE chat message (Spec 14); audio bytes live in MinIO, never here.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "chat_voice_notes"."transcript_attempt" IS
        'Monotonic per-note counter; a slower older attempt never overwrites a newer transcript.'`,
    );

    // (c) voice_note_upload_grants — object key ≠ credential (single-use, bound to conv + user).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "voice_note_upload_grants" (
        "object_key" VARCHAR(512) PRIMARY KEY,

        "conversation_id" UUID NOT NULL,

        -- Issuing user; nullable so a deleted user does not destroy the grant record
        "issued_to_user_id" UUID,

        "status" VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,

        -- The durable message that consumed the grant (at most one)
        "consumed_message_id" UUID,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "fk_voice_grant_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_voice_grant_user"
          FOREIGN KEY ("issued_to_user_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_voice_grant_message"
          FOREIGN KEY ("consumed_message_id") REFERENCES "chat_messages" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_voice_grant_status" CHECK ("status" IN ('ISSUED', 'CONSUMED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_upload_grants_conversation"
        ON "voice_note_upload_grants" ("conversation_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_upload_grants_status_expires"
        ON "voice_note_upload_grants" ("status", "expires_at")
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "voice_note_upload_grants" IS
        'Binds a server-generated object_key to a conversation + user, single-use with expiry; a key is a grant, never a credential.'`,
    );

    // (d) voice_note_object_deletions — deletion tombstone drained by the cleanup worker.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "voice_note_object_deletions" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "object_key" VARCHAR(512) NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "chk_object_deletions_status" CHECK ("status" IN ('PENDING', 'DONE'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_object_deletions_status_created"
        ON "voice_note_object_deletions" ("status", "created_at")
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "voice_note_object_deletions" IS
        'Tombstone of MinIO object_keys freed by a deleted/cascaded chat_voice_notes row; drained idempotently by the cleanup worker.'`,
    );

    // Trigger: capture the freed object_key inside the deleting transaction (rolls back with it).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION voice_note_tombstone_object() RETURNS trigger AS $$
      BEGIN
        INSERT INTO "voice_note_object_deletions" ("object_key") VALUES (OLD."object_key");
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_voice_note_tombstone_object" ON "chat_voice_notes"
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_voice_note_tombstone_object"
        BEFORE DELETE ON "chat_voice_notes"
        FOR EACH ROW EXECUTE FUNCTION voice_note_tombstone_object()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_voice_note_tombstone_object" ON "chat_voice_notes"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS voice_note_tombstone_object()`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_object_deletions_status_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "voice_note_object_deletions"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_upload_grants_status_expires"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_upload_grants_conversation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "voice_note_upload_grants"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chat_voice_notes_status_updated"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_voice_notes"`);

    // Revert the chat_messages extension: restore TEXT-only + NOT NULL body.
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP CONSTRAINT IF EXISTS "chk_chat_message_body_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP CONSTRAINT IF EXISTS "chk_chat_message_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages" ALTER COLUMN "body" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages"
         ADD CONSTRAINT "chk_chat_message_type" CHECK ("type" IN ('TEXT'))`,
    );
  }
}
