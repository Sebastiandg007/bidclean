import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationIntent, NotificationType } from './notifications.types';
import { NotificationsRepository } from './notifications.repository';
import { NotificationTypeRegistry } from './notification-type.registry';
import { PreferenceService, PreferenceSnapshot } from './preference.service';
import { localNowMinutesInZone } from './quiet-hours.util';
import { Notification } from './entities/notification.entity';
import {
  NOTIFICATIONS_JOB_NAMES,
  NOTIFICATIONS_QUEUE_NAMES,
} from './notifications.constants';

/** Optional runtime signals that refine the delivery decision (fail-open when absent). */
export interface IntentContext {
  /** True ONLY when the recipient's app is reliably known to be foregrounded for this event. */
  readonly foregroundKnownActive?: boolean;
}

/**
 * `NotificationService` — orchestrates intent creation (durable-first, atomic suppression).
 *
 * `createIntent()` computes the suppression decision FIRST, then inserts the ledger row already in
 * its final initial status (SUPPRESSED(reason) or PENDING). Because the decision and the persisted
 * status are one atomic INSERT, there is no window where a transient PENDING is observable/enqueued
 * before suppression applies. A duplicate `dedup_key` is a no-op (exactly-once intent). Delivery is
 * enqueued ONLY after a PENDING row is committed (durable-first). Never throws in a way that stops
 * the relay batch — the caller wraps each row.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly registry: NotificationTypeRegistry,
    private readonly preferences: PreferenceService,
    @InjectQueue(NOTIFICATIONS_QUEUE_NAMES.DELIVERY)
    private readonly deliveryQueue: Queue,
  ) {}

  /**
   * Create (or no-op deduplicate) a notification intent. Returns the ledger id, or the existing
   * id when the intent was already created (exactly-once), or null when the row could not be read
   * back after a concurrent insert race.
   */
  async createIntent(intent: NotificationIntent, context: IntentContext = {}): Promise<string | null> {
    const meta = this.registry.get(intent.type as NotificationType);
    const prefs = await this.loadPreferenceSnapshot(intent.recipientUserId);
    const hasConsentedDevice = await this.repo.hasConsentedDevice(intent.recipientUserId);

    const decision = this.preferences.decide({
      metadata: meta,
      prefs,
      hasConsentedDevice,
      foregroundKnownActive: context.foregroundKnownActive === true,
      localNowMinutes: localNowMinutesInZone(prefs?.quietHoursTimezone ?? null),
    });

    const isSuppressed = decision.kind === 'SUPPRESS';
    const ledgerId = await this.repo.insertLedger({
      recipientUserId: intent.recipientUserId,
      type: intent.type,
      category: intent.category,
      dedupKey: intent.dedupKey,
      deepLink: intent.deepLink,
      payloadRef: intent.payloadRef,
      priority: intent.priority,
      status: isSuppressed ? 'SUPPRESSED' : 'PENDING',
      suppressionReason: isSuppressed ? decision.reason : null,
    });

    // Duplicate dedup_key -> exactly-once intent: return the existing row id, never a second intent.
    if (ledgerId === null) {
      const existing = await this.repo.findLedgerByDedupKey(intent.dedupKey);
      return existing?.id ?? null;
    }

    // Durable-first: enqueue delivery ONLY after the PENDING row is committed. SUPPRESSED never enqueues.
    if (!isSuppressed) {
      await this.enqueueDelivery(ledgerId);
    }
    return ledgerId;
  }

  /** Self-scoped audit read of a single ledger row. */
  async getLedger(id: string): Promise<Notification | null> {
    return this.repo.findLedger(id);
  }

  /** Self-scoped audit read of a recipient's recent notifications. */
  async listForRecipient(userId: string, limit: number): Promise<Notification[]> {
    return this.repo.listForRecipient(userId, limit);
  }

  /** Load and normalize a user's preferences for the pure decision (null when none exist). */
  private async loadPreferenceSnapshot(userId: string): Promise<PreferenceSnapshot | null> {
    const prefs = await this.repo.findPreferences(userId);
    if (!prefs) {
      return null;
    }
    return {
      categoryOptOut: prefs.categoryOptOut ?? {},
      quietHoursStart: prefs.quietHoursStart,
      quietHoursEnd: prefs.quietHoursEnd,
      quietHoursTimezone: prefs.quietHoursTimezone,
    };
  }

  /** Enqueue a delivery job; a failure leaves the PENDING row recoverable by a future sweep. */
  private async enqueueDelivery(ledgerId: string): Promise<void> {
    try {
      await this.deliveryQueue.add(NOTIFICATIONS_JOB_NAMES.DELIVER, { ledgerId });
    } catch (error) {
      this.logger.warn(
        `Enqueue failed for notification ${ledgerId}; leaving PENDING for recovery: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
