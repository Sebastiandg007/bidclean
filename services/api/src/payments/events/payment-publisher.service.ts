import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PAYMENT_EVENT_NAMES,
  PaymentCapturedEvent,
  PaymentDisputedEvent,
  PaymentFailedEvent,
  PaymentReleasedEvent,
  PaymentRefundedEvent,
} from './payment-events';

/**
 * Payment domain-event publisher.
 *
 * Thin wrapper around EventEmitter2 so services emit typed payment events without
 * depending on the emitter directly. Emission never throws into the caller's flow.
 */
@Injectable()
export class PaymentPublisher {
  private readonly logger = new Logger(PaymentPublisher.name);

  constructor(private readonly emitter: EventEmitter2) {}

  emitCaptured(event: Omit<PaymentCapturedEvent, 'type' | 'timestamp'>): void {
    this.emit(PAYMENT_EVENT_NAMES.CAPTURED, { ...event, type: PAYMENT_EVENT_NAMES.CAPTURED });
  }

  emitReleased(event: Omit<PaymentReleasedEvent, 'type' | 'timestamp'>): void {
    this.emit(PAYMENT_EVENT_NAMES.RELEASED, { ...event, type: PAYMENT_EVENT_NAMES.RELEASED });
  }

  emitFailed(event: Omit<PaymentFailedEvent, 'type' | 'timestamp'>): void {
    this.emit(PAYMENT_EVENT_NAMES.FAILED, { ...event, type: PAYMENT_EVENT_NAMES.FAILED });
  }

  emitRefunded(event: Omit<PaymentRefundedEvent, 'type' | 'timestamp'>): void {
    this.emit(PAYMENT_EVENT_NAMES.REFUNDED, { ...event, type: PAYMENT_EVENT_NAMES.REFUNDED });
  }

  emitDisputed(event: Omit<PaymentDisputedEvent, 'type' | 'timestamp'>): void {
    this.emit(PAYMENT_EVENT_NAMES.DISPUTED, { ...event, type: PAYMENT_EVENT_NAMES.DISPUTED });
  }

  private emit(name: string, payload: Record<string, unknown>): void {
    try {
      this.emitter.emit(name, { ...payload, timestamp: new Date() });
    } catch (error) {
      this.logger.error(`Failed to emit ${name}: ${String(error)}`);
    }
  }
}
