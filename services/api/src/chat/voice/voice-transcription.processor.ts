import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { chatChannelForConversation } from '../chat.constants';
import {
  ChatRealtimePublisher,
  CHAT_REALTIME_PUBLISHER,
} from '../chat.service';
import { TranscriptStatus } from '../chat.types';
import { VoiceNoteRepository } from './voice-note.repository';
import { VoiceNoteStorageService } from './voice-note-storage.service';
import { WhisperClient } from './whisper.client';
import { VOICE_TRANSCRIPTION_QUEUE_NAME } from './voice.constants';

/** Job payload enqueued after a durable voice-note send (and by the stuck-PENDING sweep). */
export interface TranscriptionJobData {
  readonly messageId: string;
}

/** Realtime event name for a transcript attach/update (deduped by client on message.id). */
export const VOICE_TRANSCRIPT_UPDATED_EVENT = 'voice_transcript_updated';

/**
 * Voice transcription processor (BullMQ voice-notes-transcription queue).
 *
 * Asynchronous, best-effort, stale-update-safe: each run CLAIMS a monotonic transcript_attempt,
 * fetches the stored audio, calls the Whisper client (which sends BYTES to the AI service), and
 * attaches the result guarded by the latest-attempt rule (a slower older attempt is a no-op). On
 * transcription failure the note is marked FAILED (audio stays playable) via retry exhaustion in
 * onFailed — never failing, hiding, or duplicating the message. Bounded retries come from the
 * queue job options. A transcript is never logged verbatim; only structural outcomes are logged.
 */
@Processor(VOICE_TRANSCRIPTION_QUEUE_NAME)
export class VoiceTranscriptionProcessor extends WorkerHost {
  private readonly logger = new Logger(VoiceTranscriptionProcessor.name);

  constructor(
    private readonly voiceNoteRepository: VoiceNoteRepository,
    private readonly storage: VoiceNoteStorageService,
    private readonly whisper: WhisperClient,
    @Inject(CHAT_REALTIME_PUBLISHER)
    private readonly publisher: ChatRealtimePublisher,
  ) {
    super();
  }

  /** Process one transcription job. Errors propagate so BullMQ applies bounded retry/backoff. */
  async process(job: Job<TranscriptionJobData>): Promise<void> {
    const { messageId } = job.data;

    const context = await this.voiceNoteRepository.findTranscriptionContext(messageId);
    if (!context) {
      this.logger.warn(`Transcription skipped: voice note not found for message ${messageId}`);
      return;
    }

    const attempt = await this.voiceNoteRepository.claimTranscriptAttempt(messageId);
    if (attempt === null) {
      return;
    }

    const audio = await this.storage.getObject(context.objectKey);
    if (audio === null) {
      // The object is gone (e.g. cascaded/cleaned up) — terminal for this note, mark FAILED.
      await this.attach(
        messageId,
        attempt,
        null,
        null,
        TranscriptStatus.FAILED,
        context.conversationId,
      );
      return;
    }

    const result = await this.whisper.transcribe(audio);
    await this.attach(
      messageId,
      attempt,
      result.text,
      result.language,
      TranscriptStatus.READY,
      context.conversationId,
    );
  }

  /** On retry exhaustion, mark the note FAILED (audio remains playable) and notify clients. */
  async onFailed(job: Job<TranscriptionJobData>): Promise<void> {
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts.attempts ?? 1;
    if (attemptsMade < maxAttempts) {
      return;
    }
    const { messageId } = job.data;
    const context = await this.voiceNoteRepository.findTranscriptionContext(messageId);
    if (!context) {
      return;
    }
    await this.attach(
      messageId,
      context.transcriptAttempt,
      null,
      null,
      TranscriptStatus.FAILED,
      context.conversationId,
    );
    this.logger.error(`Transcription exhausted retries for message ${messageId}; marked FAILED`);
  }

  /** Apply the guarded transcript update and publish a best-effort message-update. */
  private async attach(
    messageId: string,
    attempt: number,
    transcript: string | null,
    language: string | null,
    status: TranscriptStatus,
    conversationId: string,
  ): Promise<void> {
    const applied = await this.voiceNoteRepository.attachTranscript({
      messageId,
      attempt,
      transcript,
      lang: language,
      status,
    });
    if (applied) {
      await this.publishUpdate(conversationId, messageId, attempt, status);
    }
  }

  /** Best-effort publish of the transcript update; a failure never fails the job. */
  private async publishUpdate(
    conversationId: string,
    messageId: string,
    attempt: number,
    status: TranscriptStatus,
  ): Promise<void> {
    try {
      await this.publisher.publish(chatChannelForConversation(conversationId), {
        type: VOICE_TRANSCRIPT_UPDATED_EVENT,
        messageId,
        transcriptAttempt: attempt,
        transcriptStatus: status,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Transcript update publish failed for message ${messageId}: ${reason}`);
    }
  }
}