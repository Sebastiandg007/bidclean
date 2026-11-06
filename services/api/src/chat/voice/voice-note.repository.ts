import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { ChatVoiceNote } from './entities/chat-voice-note.entity';
import { AttachTranscriptParams } from './voice.types';

/** Parameters to insert the 1:1 voice-note metadata row inside the send transaction. */
export interface InsertVoiceNoteParams {
  readonly messageId: string;
  readonly objectKey: string;
  readonly durationMs: number;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly waveform: number[] | null;
  readonly transcriptStatus: string;
}

/** A voice note whose transcript is stuck PENDING past the configured threshold. */
export interface StuckPendingVoiceNote {
  readonly messageId: string;
  readonly objectKey: string;
  readonly transcriptAttempt: number;
}

/** The context a transcription job needs: object key, owning conversation, current attempt. */
export interface TranscriptionContext {
  readonly objectKey: string;
  readonly conversationId: string;
  readonly transcriptAttempt: number;
}

/**
 * Voice-note repository (`chat_voice_notes`).
 *
 * Owns the 1:1 audio-metadata row for a VOICE message. `insertVoiceNote` runs inside the send
 * transaction (shared EntityManager) so the message row and its metadata are committed atomically
 * (a VOICE message can never be observed without its metadata). The transcript is derived,
 * best-effort data guarded by a monotonic `transcriptAttempt`: `claimTranscriptAttempt` bumps the
 * counter when a job starts/retries, and `attachTranscript` applies a result ONLY when its attempt
 * is the latest for that note, so a slower older attempt can never overwrite a newer result.
 * Parameterized SQL only; the transcript text is never logged.
 */
@Injectable()
export class VoiceNoteRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Insert the 1:1 metadata row atomically with the message (server-observed values). */
  async insertVoiceNote(
    manager: EntityManager,
    params: InsertVoiceNoteParams,
  ): Promise<void> {
    const repo = manager.getRepository(ChatVoiceNote);
    const row = repo.create({
      messageId: params.messageId,
      objectKey: params.objectKey,
      durationMs: params.durationMs,
      sizeBytes: params.sizeBytes,
      mimeType: params.mimeType,
      waveform: params.waveform,
      transcript: null,
      transcriptStatus: params.transcriptStatus,
      transcriptLang: null,
      transcriptAttempt: 0,
    });
    await repo.save(row);
  }

  /** Load a voice note by its message id, or null when the message is not a voice note. */
  async findByMessageId(messageId: string): Promise<ChatVoiceNote | null> {
    return this.dataSource
      .getRepository(ChatVoiceNote)
      .findOne({ where: { messageId } });
  }

  /**
   * Load the transcription work-item for a message: the object key, the owning conversation id
   * (joined from `chat_messages`, needed to publish the update on the conversation channel), and
   * the current attempt. Null when the message is not a voice note.
   */
  async findTranscriptionContext(
    messageId: string,
  ): Promise<TranscriptionContext | null> {
    const rows = await this.dataSource.query<
      Array<{
        object_key: string;
        conversation_id: string;
        transcript_attempt: number;
      }>
    >(
      `SELECT v."object_key", m."conversation_id", v."transcript_attempt"
       FROM "chat_voice_notes" v
       JOIN "chat_messages" m ON m."id" = v."message_id"
       WHERE v."message_id" = $1`,
      [messageId],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      objectKey: row.object_key,
      conversationId: row.conversation_id,
      transcriptAttempt: row.transcript_attempt,
    };
  }

  /**
   * Atomically increment and return the note's transcript_attempt. Each transcription job or
   * retry claims a strictly newer attempt before it starts, establishing the ordering the
   * stale-update guard relies on. Returns null when the note does not exist.
   */
  async claimTranscriptAttempt(messageId: string): Promise<number | null> {
    const rows = await this.dataSource.query<Array<{ transcript_attempt: number }>>(
      `UPDATE "chat_voice_notes"
       SET "transcript_attempt" = "transcript_attempt" + 1, "updated_at" = NOW()
       WHERE "message_id" = $1
       RETURNING "transcript_attempt"`,
      [messageId],
    );
    const row = rows[0];
    return row ? row.transcript_attempt : null;
  }

  /**
   * Attach a transcript result guarded by the latest-attempt rule: the update applies ONLY when
   * the supplied attempt is >= the stored 'transcript_attempt', so a slower older attempt is a
   * no-op. Returns true when the row was updated (this attempt won), false when it was stale.
   */
  async attachTranscript(params: AttachTranscriptParams): Promise<boolean> {
    const result = await this.dataSource.query<Array<{ message_id: string }>>(
      `UPDATE "chat_voice_notes"
       SET "transcript" = $1,
           "transcript_lang" = $2,
           "transcript_status" = $3,
           "updated_at" = NOW()
       WHERE "message_id" = $4 AND "transcript_attempt" <= $5
       RETURNING "message_id"`,
      [params.transcript, params.lang, params.status, params.messageId, params.attempt],
    );
    return result.length > 0;
  }

  /**
   * Select notes whose transcript has been PENDING longer than `stuckThreshold` (a lost
   * best-effort enqueue), so the stuck-PENDING sweep can re-enqueue them. Oldest-first, bounded.
   */
  async findStuckPending(
    olderThan: Date,
    limit: number,
  ): Promise<StuckPendingVoiceNote[]> {
    const rows = await this.dataSource.query<
      Array<{ message_id: string; object_key: string; transcript_attempt: number }>
    >(
      `SELECT "message_id", "object_key", "transcript_attempt"
       FROM "chat_voice_notes"
       WHERE "transcript_status" = 'PENDING' AND "updated_at" < $1
       ORDER BY "updated_at" ASC
       LIMIT $2`,
      [olderThan, limit],
    );
    return rows.map((row) => ({
      messageId: row.message_id,
      objectKey: row.object_key,
      transcriptAttempt: row.transcript_attempt,
    }));
  }

  /** Whether a live voice note references an object key (reconciler backstop input). */
  async existsForObject(objectKey: string): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ exists: boolean }>>(
      `SELECT EXISTS (
         SELECT 1 FROM "chat_voice_notes" WHERE "object_key" = $1
       ) AS exists`,
      [objectKey],
    );
    return rows[0]?.exists === true;
  }

  /** Force a note to FAILED after the stuck-PENDING sweep exhausts its bounded re-enqueues. */
  async markFailed(messageId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "chat_voice_notes"
       SET "transcript_status" = 'FAILED', "updated_at" = NOW()
       WHERE "message_id" = $1 AND "transcript_status" = 'PENDING'`,
      [messageId],
    );
  }
}