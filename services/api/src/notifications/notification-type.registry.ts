import { Injectable } from '@nestjs/common';
import {
  NotificationCategory,
  NotificationPriority,
  NotificationType,
} from './notifications.types';
import { NOTIFICATION_TYPE_METADATA } from './notifications.constants';

/**
 * Per-type metadata that drives every delivery decision. Decision logic reads this metadata rather
 * than branching on specific type names (`if incoming_call`).
 */
export interface NotificationTypeMetadata {
  readonly priority: NotificationPriority;
  readonly category: NotificationCategory;
  readonly quietHoursBehavior: 'RESPECT' | 'EXEMPT';
  readonly defaultEnabled: boolean;
}

/**
 * Config-driven registry of `NotificationType -> NotificationTypeMetadata`.
 *
 * The single authority the `PreferenceService` and mappers consult for a type's priority, category,
 * quiet-hours behavior, and default enablement. Populated from {@link NOTIFICATION_TYPE_METADATA}
 * (constants) — no literals live here. `call-invited` is HIGH + EXEMPT.
 */
@Injectable()
export class NotificationTypeRegistry {
  private readonly metadata: ReadonlyMap<NotificationType, NotificationTypeMetadata>;

  constructor() {
    this.metadata = new Map(
      (Object.entries(NOTIFICATION_TYPE_METADATA) as Array<
        [NotificationType, NotificationTypeMetadata]
      >).map(([type, meta]) => [type, meta]),
    );
  }

  /** Return metadata for a type, or throw when a type is unregistered (a config gap). */
  get(type: NotificationType): NotificationTypeMetadata {
    const meta = this.metadata.get(type);
    if (!meta) {
      throw new Error(`No NotificationType metadata registered for type: ${type}`);
    }
    return meta;
  }

  /** True when the type is registered. */
  has(type: NotificationType): boolean {
    return this.metadata.has(type);
  }

  /** All registered types (for the startup parity check). */
  types(): NotificationType[] {
    return [...this.metadata.keys()];
  }
}
