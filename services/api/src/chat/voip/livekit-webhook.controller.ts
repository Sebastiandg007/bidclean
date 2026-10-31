import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhookReceiver, WebhookEvent } from 'livekit-server-sdk';
import { RoomEndReason } from '@livekit/protocol';

import { chatChannelForConversation } from '../chat.constants';
import {
  ChatRealtimePublisher,
  CHAT_REALTIME_PUBLISHER,
} from '../chat.service';
import { Inject } from '@nestjs/common';
import { VoipRepository, VoipCallRow } from './voip.repository';
import {
  livekitWebhookApiKey,
  livekitWebhookApiSecret,
  CallStatus,
  EndReason,
} from './voip.constants';
import { SignalEventType } from './voip.types';

/** Express request carrying the preserved raw body (enabled via NestFactory rawBody). */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/** LiveKit webhook event names this ingress reacts to. */
const LIVEKIT_EVENT = {
  ROOM_STARTED: 'room_started',
  ROOM_FINISHED: 'room_finished',
  PARTICIPANT_JOINED: 'participant_joined',
  PARTICIPANT_LEFT: 'participant_left',
} as const;

/**
 * LiveKitWebhookController (`POST /webhooks/livekit`, public — NOT JWT).
 *
 * Server-authoritative liveness ingress. Authenticated by the LiveKit signature over the PRESERVED
 * RAW BODY (the LiveKit `WebhookReceiver` verifies the `Authorization` JWT against the raw payload —
 * the same "verify over raw body" shape as the Stripe/RevenueCat controllers). Idempotent:
 * `participant_joined`/`participant_left`/`room_started` bump `last_media_activity_at`;
 * `room_finished` is a LIVENESS SIGNAL, never a blind verdict — a benign empty close of a still-
 * ONGOING call may single-winner transition it to ENDED/HANGUP, an explicit error close maps to
 * FAILED/ERROR, and an ambiguous close is LEFT to the stale-call sweep (it never becomes a generic
 * ENDED here). A bad/missing signature → 401 with NO mutation; an unknown room or duplicate →
 * idempotent 200. Media/PII are never logged.
 */
@Controller('webhooks')
export class LiveKitWebhookController {
  private readonly logger = new Logger(LiveKitWebhookController.name);
  private receiver: WebhookReceiver | null = null;

  constructor(
    private readonly voipRepository: VoipRepository,
    @Inject(CHAT_REALTIME_PUBLISHER)
    private readonly publisher: ChatRealtimePublisher,
  ) {}

  /** POST /webhooks/livekit */
  @Post('livekit')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req() req: RawBodyRequest,
    @Headers('authorization') authorization?: string,
  ): Promise<{ received: true }> {
    const rawBody = req.rawBody?.toString('utf8');
    if (rawBody === undefined) {
      // No body to authenticate — treat as an auth failure, never mutate.
      throw new UnauthorizedException('Missing raw request body');
    }

    const event = await this.authenticate(rawBody, authorization ?? null);
    await this.applyEvent(event);
    return { received: true };
  }

  /** Verify the LiveKit signature over the raw body; reject with 401 and NO mutation on failure. */
  private async authenticate(
    rawBody: string,
    authorization: string | null,
  ): Promise<WebhookEvent> {
    if (!authorization) {
      throw new UnauthorizedException('Missing LiveKit webhook signature');
    }
    try {
      return await this.receiverInstance().receive(rawBody, authorization);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      // Never echo the body; only the structural failure reason.
      throw new UnauthorizedException(`LiveKit webhook authentication failed: ${reason}`);
    }
  }

  /** Route an authenticated event to the liveness update or the cause-interpreted close. */
  private async applyEvent(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    if (!roomName) {
      // No room context (e.g. an ingress/egress event we do not track) — idempotent no-op.
      return;
    }

    switch (event.event) {
      case LIVEKIT_EVENT.ROOM_STARTED:
      case LIVEKIT_EVENT.PARTICIPANT_JOINED:
      case LIVEKIT_EVENT.PARTICIPANT_LEFT:
        await this.voipRepository.touchMediaActivity(roomName, this.eventTime(event));
        return;
      case LIVEKIT_EVENT.ROOM_FINISHED:
        await this.handleRoomFinished(roomName, event);
        return;
      default:
        // Any other event is not a liveness signal we track — idempotent no-op.
        return;
    }
  }

  /**
   * `room_finished` cause interpretation (P13). A room finish is a signal, not a verdict:
   *   - the call is not ONGOING (or unknown room) → idempotent no-op;
   *   - an explicit media/server ERROR cause → single-winner ONGOING → FAILED/ERROR;
   *   - otherwise (benign/ambiguous empty close) → LEAVE it to the stale-call sweep, which resolves
   *     it as ENDED/TIMEOUT — never a blind generic ENDED here.
   */
  private async handleRoomFinished(roomName: string, event: WebhookEvent): Promise<void> {
    const call = await this.voipRepository.findByRoomName(roomName);
    if (!call || call.status !== CallStatus.ONGOING) {
      return; // Unknown room or already-terminal / not-yet-ongoing → no-op.
    }

    if (this.isErrorClose(event)) {
      const winner = await this.voipRepository.transitionTerminal(
        call.id,
        CallStatus.ONGOING,
        CallStatus.FAILED,
        EndReason.ERROR,
      );
      if (winner) {
        await this.publishEnd(call, winner, EndReason.ERROR);
      }
      return;
    }
    // Benign/ambiguous close: defer to the stale-call sweep (do NOT bump activity — the room is gone).
  }

  /**
   * Whether a `room_finished` event carries an explicit media/server error cause. A normal empty
   * close (idle timeout, API delete) is benign and deferred to the sweep; only a genuine server/
   * open failure maps to FAILED/ERROR.
   */
  private isErrorClose(event: WebhookEvent): boolean {
    const reason = event.roomEndReason;
    return (
      reason === RoomEndReason.ROOM_END_OPEN_FAILED ||
      reason === RoomEndReason.ROOM_END_SERVER_SHUTDOWN
    );
  }

  /** Best-effort `call_end` publish for a webhook-driven terminal transition. */
  private async publishEnd(
    call: VoipCallRow,
    winner: VoipCallRow,
    endReason: EndReason,
  ): Promise<void> {
    try {
      await this.publisher.publish(chatChannelForConversation(call.conversation_id), {
        type: SignalEventType.CALL_END,
        callId: call.id,
        endReason,
        durationSeconds: winner.duration_seconds,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Webhook call_end publish failed for call ${call.id}: ${reason}`);
    }
  }

  /** The event's timestamp, or now when absent. */
  private eventTime(event: WebhookEvent): Date {
    const createdAt = (event as { createdAt?: number | bigint }).createdAt;
    if (typeof createdAt === 'number' && createdAt > 0) {
      return new Date(createdAt * 1000);
    }
    return new Date();
  }

  /** Lazily construct the receiver from the (webhook-or-API) key pair. */
  private receiverInstance(): WebhookReceiver {
    if (!this.receiver) {
      this.receiver = new WebhookReceiver(livekitWebhookApiKey(), livekitWebhookApiSecret());
    }
    return this.receiver;
  }
}
