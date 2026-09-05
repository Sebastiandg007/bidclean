import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../auth/entities/user.entity';
import { NegotiationRepository } from '../negotiation/negotiation.repository';
import { CentrifugoClient } from '../offers/delivery/centrifugo.client';
import { OffersModule } from '../offers/offers.module';
import { ChatController } from './chat.controller';
import { ChatParticipationService } from './chat-participation.service';
import { ChatRepository } from './chat.repository';
import { ChatService, CHAT_REALTIME_PUBLISHER } from './chat.service';
import { validateChatConfig } from './chat.constants';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { OfferTerminalChatListener } from './listeners/offer-terminal-chat.listener';

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
    TypeOrmModule.forFeature([ChatConversation, ChatMessage, User]),
    OffersModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatRepository,
    ChatParticipationService,
    NegotiationRepository,
    OfferTerminalChatListener,
    { provide: CHAT_REALTIME_PUBLISHER, useExisting: CentrifugoClient },
  ],
  exports: [ChatParticipationService, ChatService],
})
export class ChatModule implements OnModuleInit {
  onModuleInit(): void {
    validateChatConfig();
  }
}
