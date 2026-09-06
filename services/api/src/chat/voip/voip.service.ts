import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

import { chatChannelForConversation } from '../chat.constants';
import {
  ChatRealtimePublisher,
  CHAT_REALTIME_PUBLISHER,
} from '../chat.service';
import { ChatConversation } from '../entities/chat-conversation.entity';
import { LiveKitRoomService } from './livekit-room.service';
import { LiveKitTokenService } from './livekit-token.service';
import { VoipRepository, VoipCallRow } from './voip.repository';
import {
  CallStatus,
  EndReason,
  MediaKind,
  VOIP_VIDEO_ENABLED,
} from './voip.constants';
import {
  CallView,
  InitiateParams,
  InitiatedCall,
  MediaToken,
  SignalEvent,
  SignalEventType,
  VOIP_ERROR_MESSAGES,
} from './voip.types';

/** The Postgres unique-violation SQLSTATE — a concurrent second active call trips this. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * VoipService — the call state machine + authorization gates (Spec 15).
 *
 * A call is a `voip_calls` row bound to one Spec 13 conversation; it reuses the conversation's
 * participants and OPEN-lifecycle rule unchanged. This service owns:
 *   - durable-first initiate (serialized transaction: participant + OPEN + dedup + insert RINGING
 *     with a generated room, the DB partial-unique index being the hard "one active call" guarantee)
 *     THEN mint the initiator token THEN best-effort `call_invite`;
 *   - the answer/decline/cancel/end transitions as SINGLE-WINNER conditional writes (idempotent
 *     no-op when already terminal);
 *   - the media-token STATUS+ROLE gate (RINGING → initiator only; ONGOING → either; terminal →
 *     none) with the room always resolved from the DB;
 *   - reconciliation reads and the offer-terminal force-end.
 *
 * PostgreSQL is authoritative; LiveKit is the media transport; Centrifugo is best-effort signaling.
 * Room names, media tokens, and participant PII are never logged.
 */
@Injectable()
export class VoipService {
  private readonly logger = new Logger(VoipService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly voipRepository: VoipRepository,
    private readonly roomService: LiveKitRoomService,
    private readonly tokenService: LiveKitTokenService,
    @Inject(CHAT_REALTIME_PUBLISHER)
    private readonly publisher: ChatRealtimePublisher,
  ) {}

  /**
   * Initiate a call. Serialized transaction: verify participant + OPEN, dedup on
   * `(conversation, initiator, clientCallId)`, insert RINGING with a generated room. A concurrent
   * second active call violates the partial unique index → mapped to `409 busy` + minimal
   * `call_busy`. After commit: mint the initiator's token, best-effort `call_invite`.
   */
  async initiate(params: InitiateParams): Promise<InitiatedCall> {
    const mediaKind = this.resolveMediaKind(params.mediaKind);

    let row: VoipCallRow;
    let deduped = false;
    try {
      row = await this.dataSource.transaction(async (manager) => {
        const conversation = await this.loadConversationForUpdate(
          manager,
          params.conversationId,
        );
        this.assertParticipant(conversation, params.callerId);

        const existing = await this.voipRepository.findConsumableByClientCallId(
          manager,
          params.conversationId,
          params.callerId,
          params.clientCallId,
        );
        if (existing) {
          deduped = true;
          return existing;
        }

        if (conversation.status !== 'OPEN') {
          throw new ConflictException(VOIP_ERROR_MESSAGES.CONVERSATION_CLOSED);
        }

        const calleeId = this.otherParticipant(conversation, params.callerId);
        return this.voipRepository.insertRinging(manager, {
          conversationId: params.conversationId,
          offerId: conversation.offerId,
          initiatorId: params.callerId,
          calleeId,
          mediaKind,
          roomName: this.roomService.generateRoomName(),
          clientCallId: params.clientCallId,
        });
      });
    } catch (error) {
      throw this.mapInitiateError(error, params.conversationId);
    }

    // TODO(orchestrator): emit voip_outbox call-invited here — push Task 12. When a call reaches
    // RINGING (a fresh insert, not a dedup), push-notifications will write a `voip_outbox` row so a
    // backgrounded/killed callee can be woken. This service intentionally does NOT write that outbox
    // (out of scope for voip-calls); the durable RINGING row committed above is the single trigger
    // point the orchestrator wires push into.

    const media = await this.tokenService.mintToken({
      identity: params.callerId,
      roomName: row.room_name,
      canPublishVideo: mediaKind === MediaKind.VIDEO,
    });

    if (!deduped) {
      await this.publishSignal(params.conversationId, {
        type: SignalEventType.CALL_INVITE,
        callId: row.id,
        conversationId: params.conversationId,
        initiatorId: row.initiator_id,
        mediaKind,
      });
    }

    return { call: this.toView(row), roomName: row.room_name, media };
  }

  /**
   * Answer a RINGING call: assert the caller is the callee, single-winner RINGING → ONGOING, mint
   * the callee's token (room from the DB), best-effort `call_accept`. Zero rows updated → the call
   * was already answered/terminal → 409.
   */
  async answer(
    conversationId: string,
    callId: string,
    userId: string,
  ): Promise<MediaToken> {
    const call = await this.requireParticipantCall(conversationId, callId, userId);
    if (call.callee_id !== userId) {
      throw new ForbiddenException(VOIP_ERROR_MESSAGES.WRONG_ROLE);
    }

    const answered = await this.voipRepository.answer(callId);
    if (!answered) {
      throw new ConflictException(VOIP_ERROR_MESSAGES.ILLEGAL_TRANSITION);
    }

    const media = await this.tokenService.mintToken({
      identity: userId,
      roomName: answered.room_name,
      canPublishVideo: answered.media_kind === MediaKind.VIDEO,
    });

    await this.publishSignal(conversationId, {
      type: SignalEventType.CALL_ACCEPT,
      callId,
    });
    return media;
  }

  /** Decline a RINGING call (callee): single-winner RINGING → DECLINED. Idempotent no-op if terminal. */
  async decline(
    conversationId: string,
    callId: string,
    userId: string,
  ): Promise<CallView> {
    const call = await this.requireParticipantCall(conversationId, callId, userId);
    return this.terminalFromRinging(
      conversationId,
      call,
      CallStatus.DECLINED,
      EndReason.DECLINED,
      SignalEventType.CALL_DECLINE,
    );
  }

  /** Cancel a RINGING call (initiator, before answer): single-winner RINGING → CANCELED. */
  async cancel(
    conversationId: string,
    callId: string,
    userId: string,
  ): Promise<CallView> {
    const call = await this.requireParticipantCall(conversationId, callId, userId);
    return this.terminalFromRinging(
      conversationId,
      call,
      CallStatus.CANCELED,
      EndReason.CANCELED,
      SignalEventType.CALL_CANCEL,
    );
  }

  /**
   * End a call: single-winner terminal write from whichever non-terminal status it is in
   * (RINGING → CANCELED-equivalent hangup, or ONGOING → ENDED). Idempotent: an already-terminal
   * call returns its current state without re-deriving duration or re-publishing.
   */
  async end(
    conversationId: string,
    callId: string,
    userId: string,
  ): Promise<CallView> {
    const call = await this.requireParticipantCall(conversationId, callId, userId);

    // Already terminal → idempotent no-op (return current state).
    if (this.isTerminal(call.status)) {
      return this.toView(call);
    }

    const expected = call.status as CallStatus;
    const winner = await this.voipRepository.transitionTerminal(
      callId,
      expected,
      CallStatus.ENDED,
      EndReason.HANGUP,
    );
    if (!winner) {
      // Lost the race: someone else drove it terminal. Return the now-current state.
      const current = await this.voipRepository.findById(callId);
      return this.toView(current ?? call);
    }

    await this.publishSignal(conversationId, {
      type: SignalEventType.CALL_END,
      callId,
      endReason: EndReason.HANGUP,
      durationSeconds: winner.duration_seconds,
    });
    return this.toView(winner);
  }

  /**
   * Mint a media (LiveKit access) token for an existing call — the STATUS+ROLE gate:
   *   - RINGING → initiator only (the callee must use `answer`);
   *   - ONGOING → either participant (the media-reconnect / rejoin path);
   *   - terminal → no token for anyone.
   * The room is ALWAYS resolved from the persisted call record — never accepted from the client.
   */
  async mintMediaToken(
    conversationId: string,
    callId: string,
    userId: string,
  ): Promise<MediaToken> {
    const call = await this.requireParticipantCall(conversationId, callId, userId);

    if (call.status === CallStatus.RINGING) {
      if (call.initiator_id !== userId) {
        // The callee obtains a token only by answering — never a bare token request while RINGING.
        throw new ForbiddenException(VOIP_ERROR_MESSAGES.TOKEN_NOT_ALLOWED);
      }
    } else if (call.status !== CallStatus.ONGOING) {
      // Any terminal status: no token, ever.
      throw new ConflictException(VOIP_ERROR_MESSAGES.TOKEN_NOT_ALLOWED);
    }

    return this.tokenService.mintToken({
      identity: userId,
      roomName: call.room_name,
      canPublishVideo: call.media_kind === MediaKind.VIDEO,
    });
  }

  /** Read a single call the caller participates in (reconciliation). */
  async getCall(
    conversationId: string,
    callId: string,
    userId: string,
  ): Promise<CallView> {
    const call = await this.requireParticipantCall(conversationId, callId, userId);
    return this.toView(call);
  }

  /** Read call history for a conversation the caller participates in (missed-call UX). */
  async listCalls(
    conversationId: string,
    userId: string,
    before: Date | null,
    limit: number,
  ): Promise<CallView[]> {
    await this.requireParticipantConversation(conversationId, userId);
    const rows = await this.voipRepository.listForConversation(conversationId, before, limit);
    return rows.map((row) => this.toView(row));
  }

  /**
   * Force-end every non-terminal call of a conversation (offer-terminal / conversation-close path).
   * Single-winner per row, idempotent; best-effort `call_end` per ended call. Never throws for the
   * listener (a failure is logged upstream).
   */
  async forceEndForConversation(
    conversationId: string,
    reason: EndReason = EndReason.CONVERSATION_CLOSED,
  ): Promise<void> {
    const ended = await this.voipRepository.forceEndForConversation(
      conversationId,
      CallStatus.ENDED,
      reason,
    );
    for (const row of ended) {
      await this.publishSignal(conversationId, {
        type: SignalEventType.CALL_END,
        callId: row.id,
        endReason: reason,
        durationSeconds: row.duration_seconds,
      });
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** A shared terminal-from-RINGING transition (decline/cancel), idempotent + single-winner. */
  private async terminalFromRinging(
    conversationId: string,
    call: VoipCallRow,
    terminalStatus: CallStatus,
    endReason: EndReason,
    signalType: SignalEvent['type'],
  ): Promise<CallView> {
    if (this.isTerminal(call.status)) {
      return this.toView(call);
    }
    const winner = await this.voipRepository.transitionTerminal(
      call.id,
      CallStatus.RINGING,
      terminalStatus,
      endReason,
    );
    if (!winner) {
      const current = await this.voipRepository.findById(call.id);
      return this.toView(current ?? call);
    }
    await this.publishSignal(conversationId, {
      type: signalType,
      callId: call.id,
    } as SignalEvent);
    return this.toView(winner);
  }

  /** Resolve the requested media kind against the video-enabled flag (degrade to AUDIO). */
  private resolveMediaKind(requested: MediaKind): MediaKind {
    if (requested === MediaKind.VIDEO && VOIP_VIDEO_ENABLED) {
      return MediaKind.VIDEO;
    }
    return MediaKind.AUDIO;
  }

  /** Row-lock the conversation for the serialized initiate transaction. 404 when missing. */
  private async loadConversationForUpdate(
    manager: EntityManager,
    conversationId: string,
  ): Promise<ChatConversation> {
    const rows = await manager.query<ChatConversation[]>(
      `SELECT "id", "offer_id" AS "offerId", "host_id" AS "hostId",
              "cleaner_id" AS "cleanerId", "status"
       FROM "chat_conversations" WHERE "id" = $1 FOR UPDATE`,
      [conversationId],
    );
    const conversation = rows[0];
    if (!conversation) {
      throw new NotFoundException(VOIP_ERROR_MESSAGES.CONVERSATION_NOT_FOUND);
    }
    return conversation;
  }

  /** Load a call + assert the caller participates in its conversation (404/403). */
  private async requireParticipantCall(
    conversationId: string,
    callId: string,
    userId: string,
  ): Promise<VoipCallRow> {
    await this.requireParticipantConversation(conversationId, userId);
    const call = await this.voipRepository.findById(callId);
    if (!call || call.conversation_id !== conversationId) {
      throw new NotFoundException(VOIP_ERROR_MESSAGES.CALL_NOT_FOUND);
    }
    return call;
  }

  /** Load a conversation + assert the caller participates (404 missing / 403 non-participant). */
  private async requireParticipantConversation(
    conversationId: string,
    userId: string,
  ): Promise<ChatConversation> {
    const conversation = await this.dataSource
      .getRepository(ChatConversation)
      .findOne({ where: { id: conversationId } });
    if (!conversation) {
      throw new NotFoundException(VOIP_ERROR_MESSAGES.CONVERSATION_NOT_FOUND);
    }
    this.assertParticipant(conversation, userId);
    return conversation;
  }

  /** Assert the user is one of the conversation's two participants (403 otherwise). */
  private assertParticipant(conversation: ChatConversation, userId: string): void {
    if (userId !== conversation.hostId && userId !== conversation.cleanerId) {
      throw new ForbiddenException(VOIP_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
  }

  /** The other participant of the conversation relative to `userId`. */
  private otherParticipant(conversation: ChatConversation, userId: string): string {
    const other = userId === conversation.hostId ? conversation.cleanerId : conversation.hostId;
    if (!other) {
      // Both participants are always present for an OPEN conversation; a null here is a data break.
      throw new ConflictException(VOIP_ERROR_MESSAGES.CONVERSATION_CLOSED);
    }
    return other;
  }

  /** Map an initiate failure: a unique-violation on the active-call index → 409 busy + call_busy. */
  private mapInitiateError(error: unknown, conversationId: string): Error {
    if (this.isUniqueViolation(error)) {
      // A concurrent active call already exists. Publish a MINIMAL call_busy (no room/token).
      void this.publishBusyBestEffort(conversationId);
      return new ConflictException(VOIP_ERROR_MESSAGES.CALL_BUSY);
    }
    return error instanceof Error ? error : new Error('initiate failed');
  }

  /** Whether an error is a Postgres unique-constraint violation. */
  private isUniqueViolation(error: unknown): boolean {
    if (error instanceof QueryFailedError) {
      const code = (error as unknown as { code?: string }).code;
      return code === PG_UNIQUE_VIOLATION;
    }
    if (error && typeof error === 'object' && 'code' in error) {
      return (error as { code?: string }).code === PG_UNIQUE_VIOLATION;
    }
    return false;
  }

  /** Publish a minimal `call_busy` for the conversation's active call (best-effort, no details). */
  private async publishBusyBestEffort(conversationId: string): Promise<void> {
    const active = await this.voipRepository.findActiveForConversation(conversationId);
    if (!active) {
      return;
    }
    await this.publishSignal(conversationId, {
      type: SignalEventType.CALL_BUSY,
      callId: active.id,
    });
  }

  /** Publish a call-control signal best-effort; a transport failure never fails the request. */
  private async publishSignal(conversationId: string, event: SignalEvent): Promise<void> {
    try {
      await this.publisher.publish(chatChannelForConversation(conversationId), event);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Call signal publish failed for conversation ${conversationId}: ${reason}`);
    }
  }

  /** Whether a status is terminal (immutable). */
  private isTerminal(status: string): boolean {
    return (
      status === CallStatus.ENDED ||
      status === CallStatus.MISSED ||
      status === CallStatus.DECLINED ||
      status === CallStatus.CANCELED ||
      status === CallStatus.FAILED
    );
  }

  /** Project a raw call row to its client view (no room name — never a stable public identifier). */
  private toView(row: VoipCallRow): CallView {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      initiatorId: row.initiator_id,
      calleeId: row.callee_id,
      mediaKind: row.media_kind as MediaKind,
      status: row.status as CallStatus,
      endReason: (row.end_reason as EndReason | null) ?? null,
      initiatedAt: row.initiated_at.toISOString(),
      answeredAt: row.answered_at ? row.answered_at.toISOString() : null,
      endedAt: row.ended_at ? row.ended_at.toISOString() : null,
      durationSeconds: row.duration_seconds,
    };
  }
}
