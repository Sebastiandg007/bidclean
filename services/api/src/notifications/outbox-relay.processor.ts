import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationsRepository, OutboxRowRecord } from './notifications.repository';
import { NotificationService } from './notification.service';
import { OutboxMapper } from './mappers/outbox-mapper.types';
import { OfferOutboxMapper } from './mappers/offer-outbox.mapper';
import { PaymentOutboxMapper } from './mappers/payment-outbox.mapper';
import { NegotiationOutboxMapper } from './mappers/negotiation-outbox.mapper';
import { ChatOutboxMapper } from './mappers/chat-outbox.mapper';
import { VoipOutboxMapper } from './mappers/voip-outbox.mapper';
import { OutboxEntityBase } from './entities/outbox.entity';
import {
  NOTIFICATIONS_RELAY_BATCH_SIZE,
  NOTIFICATIONS_RELAY_INTERVAL_MS,
} from './notifications.constants';

/** Pairs a physical outbox table with the mapper that shapes its rows into intents. */
interface OutboxSource {
  readonly tableName: string;
  readonly mapper: OutboxMapper;
}

/**
 * `OutboxRelayProcessor` — drains the five per-domain outbox tables into deduped intents.
 *
 * Repeatable (interval + batch from config). For each unrelayed row (oldest first): build the
 * intent via the domain mapper, call `NotificationService.createIntent()`, then `markRelayed`.
 * Row-scoped try/catch: a mapper/intent throw leaves the row unrelayed for the next drain and
 * NEVER touches the (already committed) emitting transaction — the notifications side is isolated.
 * At-least-once and idempotent (a re-drained row is deduped by the ledger `dedup_key`).
 */
@Injectable()
export class OutboxRelayProcessor {
  private readonly logger = new Logger(OutboxRelayProcessor.name);
  private readonly sources: readonly OutboxSource[];

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly notifications: NotificationService,
    offerMapper: OfferOutboxMapper,
    paymentMapper: PaymentOutboxMapper,
    negotiationMapper: NegotiationOutboxMapper,
    chatMapper: ChatOutboxMapper,
    voipMapper: VoipOutboxMapper,
  ) {
    this.sources = [
      { tableName: 'offer_outbox', mapper: offerMapper },
      { tableName: 'payment_outbox', mapper: paymentMapper },
      { tableName: 'negotiation_outbox', mapper: negotiationMapper },
      { tableName: 'chat_outbox', mapper: chatMapper },
      { tableName: 'voip_outbox', mapper: voipMapper },
    ];
  }

  /** Relay interval resolved from configuration (static so the decorator can read it). */
  static getInterval(): number {
    return NOTIFICATIONS_RELAY_INTERVAL_MS;
  }

  @Interval(OutboxRelayProcessor.getInterval())
  async drainAll(): Promise<void> {
    for (const source of this.sources) {
      try {
        await this.drainSource(source);
      } catch (error) {
        // A whole-source failure (e.g. DB blip) is logged and retried next interval.
        this.logger.warn(
          `Relay drain failed for ${source.tableName}: ${this.safeError(error)}`,
        );
      }
    }
  }

  /** Drain one outbox table for a bounded batch, mapping + persisting each row independently. */
  async drainSource(source: OutboxSource): Promise<void> {
    const rows = await this.repo.findUnrelayed(source.tableName, NOTIFICATIONS_RELAY_BATCH_SIZE);
    for (const row of rows) {
      await this.relayRow(source, row);
    }
  }

  /** Relay a single row: map -> createIntent -> markRelayed. Row-scoped failure isolation. */
  private async relayRow(source: OutboxSource, row: OutboxRowRecord): Promise<void> {
    try {
      const intent = source.mapper.map(row as unknown as OutboxEntityBase);
      if (intent !== null) {
        await this.notifications.createIntent(intent);
      }
      // Whether mapped or intentionally skipped (null), the row is fully processed -> mark relayed.
      await this.repo.markRelayed(source.tableName, row.eventId);
    } catch (error) {
      // Leave the row unrelayed; the next drain retries it. The emitting TX is already committed.
      this.logger.warn(
        `Relay failed for ${source.tableName} event ${row.eventId}: ${this.safeError(error)}`,
      );
    }
  }

  private safeError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
