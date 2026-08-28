import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OffersModule } from '../offers/offers.module';
import { User } from '../auth/entities/user.entity';
import { Offer } from '../offers/entities/offer.entity';
import { NegotiationController } from './negotiation.controller';
import { NegotiationService } from './negotiation.service';
import { NegotiationRepository } from './negotiation.repository';
import { NegotiationIdempotencyService } from './negotiation-idempotency.service';
import { NegotiationPricingService } from './pricing/negotiation-pricing.service';
import { NegotiationPublisher } from './events/negotiation-publisher.service';
import { OfferTerminalListener } from './listeners/offer-terminal.listener';
import { NegotiationReconciliationService } from './reconciliation/negotiation-reconciliation.service';
import { ProposalExpiryWorker } from './expiration/proposal-expiry.worker';
import { NegotiationThread } from './entities/negotiation-thread.entity';
import { NegotiationProposal } from './entities/negotiation-proposal.entity';
import { validateNegotiationConfig } from './negotiation.constants';

/**
 * Negotiation module.
 *
 * Owns the accept/counteroffer lifecycle and match finalization. Imports
 * OffersModule to consume the OFFER_MATCH contract, CommissionService, and
 * CentrifugoClient. Registers the terminal-state listener (single supersession
 * authority), the reconciliation service, and the proposal expiration worker.
 *
 * Validates its configuration at startup (fail-fast).
 */
@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([NegotiationThread, NegotiationProposal, Offer, User]),
    OffersModule,
  ],
  controllers: [NegotiationController],
  providers: [
    NegotiationService,
    NegotiationRepository,
    NegotiationIdempotencyService,
    NegotiationPricingService,
    NegotiationPublisher,
    OfferTerminalListener,
    NegotiationReconciliationService,
    ProposalExpiryWorker,
  ],
  exports: [NegotiationService],
})
export class NegotiationModule implements OnModuleInit {
  onModuleInit(): void {
    validateNegotiationConfig();
  }
}
