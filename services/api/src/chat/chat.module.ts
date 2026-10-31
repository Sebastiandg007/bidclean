import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { Queue } from 'bullmq';

import { User } from '../auth/entities/user.entity';
import { NegotiationRepository } from '../negotiation/negotiation.repository';
import { CentrifugoClient } from '../offers/delivery/centrifugo.client';
import { OffersModule } from '../offers/offers.module';
import { ChatController } from './chat.controller';
import { ChatParticipationService } from './chat-participation.service';
import { ChatRepository } from './chat.repository';
import {
  ChatService,
  CHAT_REALTIME_PUBLISHER,
  VOICE_TRANSCRIPTION_ENQUEUER,
} from './chat.service';
import { validateChatConfig } from './chat.constants';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { OfferTerminalChatListener } from './listeners/offer-terminal-chat.listener';
// --- voice-notes providers ---
import { validateVoiceNotesConfig } from './voice/voice.constants';
import {
  VOICE_TRANSCRIPTION_JOB_OPTIONS,
  VOICE_TRANSCRIPTION_QUEUE_NAME,
} from './voice/voice.constants';
import { AudioDurationProbe } from './voice/audio-duration.probe';
import { VoiceNoteStorageService } from './voice/voice-note-storage.service';
import { UploadGrantRepository } from './voice/upload-grant.repository';
import { VoiceNoteRepository } from './voice/voice-note.repository';
import { ObjectDeletionRepository } from './voice/object-deletion.repository';
import { WhisperClient } from './voice/whisper.client';
import { VoiceTranscriptionProcessor } from './voice/voice-transcription.processor';
import { VoiceNoteCleanupProcessor } from './voice/voice-note-cleanup.processor';
import { ChatVoiceNote } from './voice/entities/chat-voice-note.entity';
import { VoiceNoteUploadGrant } from './voice/entities/voice-note-upload-grant.entity';
import { VoiceNoteObjectDeletion } from './voice/entities/voice-note-object-deletion.entity';
// --- voip-calls providers ---
import { validateVoipConfig } from './voip/voip.constants';
import {
  VOIP_SWEEP_JOB_OPTIONS,
  VOIP_SWEEP_QUEUE_NAME,
} from './voip/voip.constants';
import { VoipCall } from './voip/entities/voip-call.entity';
import { VoipController } from './voip/voip.controller';
import { VoipService } from './voip/voip.service';
import { VoipRepository } from './voip/voip.repository';
import { LiveKitRoomService } from './voip/livekit-room.service';
import { LiveKitTokenService } from './voip/livekit-token.service';
import { LiveKitWebhookController } from './voip/livekit-webhook.controller';
import { VoipSweepProcessor } from './voip/voip-sweep.processor';
import { OfferTerminalCallListener } from './voip/offer-terminal-call.listener';

/**
 * Chat module (realtime-chat).
 *
 * Owns post-match Host<->Cleaner conversations and messages. Reuses the existing `CentrifugoClient`
 * (exported by `OffersModule`) as the best-effort realtime transport — bound to the
 * `CHAT_REALTIME_PUBLISHER` seam so the service depends on an interface, not the HTTP client. Uses
 * `NegotiationRepository` to gate conversation creation on a match. EXPORTS
 * `ChatParticipationService` so the auth module's Centrifugo token endpoint can authorize private
 * subscriptions (auth owns tokens, chat owns the participation rule). Validates its config at
 * startup (fail-fast).
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      ChatConversation,
      ChatMessage,
      User,
      // --- voice-notes entities ---
      ChatVoiceNote,
      VoiceNoteUploadGrant,
      VoiceNoteObjectDeletion,
      // --- voip-calls entity ---
      VoipCall,
    ]),
    OffersModule,
    // --- voice-notes async infra (transcription queue + repeatable cleanup sweeps) ---
    // ScheduleModule.forRoot() is registered here by voice-notes; voip-calls REUSES it (no dup).
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: VOICE_TRANSCRIPTION_QUEUE_NAME,
      defaultJobOptions: VOICE_TRANSCRIPTION_JOB_OPTIONS,
    }),
    // --- voip-calls async infra (repeatable ring-timeout + stale-call sweep queue) ---
    BullModule.registerQueue({
      name: VOIP_SWEEP_QUEUE_NAME,
      defaultJobOptions: VOIP_SWEEP_JOB_OPTIONS,
    }),
  ],
  controllers: [ChatController, VoipController, LiveKitWebhookController],
  providers: [
    ChatService,
    ChatRepository,
    ChatParticipationService,
    NegotiationRepository,
    OfferTerminalChatListener,
    { provide: CHAT_REALTIME_PUBLISHER, useExisting: CentrifugoClient },
    // --- voice-notes providers ---
    AudioDurationProbe,
    VoiceNoteStorageService,
    UploadGrantRepository,
    VoiceNoteRepository,
    ObjectDeletionRepository,
    WhisperClient,
    VoiceTranscriptionProcessor,
    VoiceNoteCleanupProcessor,
    {
      provide: VOICE_TRANSCRIPTION_ENQUEUER,
      useFactory: (queue: Queue) => queue,
      inject: [getQueueToken(VOICE_TRANSCRIPTION_QUEUE_NAME)],
    },
    // --- voip-calls providers ---
    VoipService,
    VoipRepository,
    LiveKitRoomService,
    LiveKitTokenService,
    VoipSweepProcessor,
    OfferTerminalCallListener,
  ],
  exports: [ChatParticipationService, ChatService],
})
export class ChatModule implements OnModuleInit {
  onModuleInit(): void {
    validateChatConfig();
    // --- voice-notes fail-fast config validation ---
    validateVoiceNotesConfig();
    // --- voip-calls fail-fast config validation ---
    validateVoipConfig();
  }
}
