import { Injectable, Logger } from '@nestjs/common';
import { OfferDomainEvent } from './offer-domain-events';

/**
 * Offer event emitter service.
 *
 * Emits domain events on every offer state transition via NestJS EventEmitter2.
 * Provides a single point of emission for all offer-related domain events.
 *
 * Consumers subscribe via @OnEvent decorators in their own modules.
 */
@Injectable()
export class OfferEventEmitterService {
  private readonly logger = new Logger(OfferEventEmitterService.name);

  /**
   * Emit a domain event.
   */
  emit(event: OfferDomainEvent): void {
    // TODO: Implement with EventEmitter2 in Task 15
    this.logger.debug(`Domain event emitted: ${event.type}`);
  }
}
