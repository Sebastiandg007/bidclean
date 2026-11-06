import { Injectable, Logger } from '@nestjs/common';
import { User } from '../auth/entities/user.entity';
import { NotificationsRepository } from './notifications.repository';
import { OneSignalClient } from './onesignal/onesignal.client';

/** A subscription-change reported by the OneSignal webhook, normalized. */
export interface SubscriptionWebhookEvent {
  readonly kind: 'unsubscribe' | 'token_invalidated' | 'player_id_change';
  readonly playerId: string;
}

/** Minimal per-device shape used by the pure Model B targeting filter. */
export interface DeviceForTargeting {
  readonly onesignalPlayerId: string;
  readonly consentGranted: boolean;
  readonly isStale: boolean;
}

/**
 * Pure Model B targeting filter: the set of player ids that may be targeted is EXACTLY the
 * consented, non-stale devices. This mirrors the SQL of `resolveConsentedPlayerIds` and is the
 * unit under Property 6. Never a blanket external-user-id fan-out.
 */
export function selectTargetPlayerIds(devices: readonly DeviceForTargeting[]): string[] {
  return devices
    .filter((device) => device.consentGranted && !device.isStale)
    .map((device) => device.onesignalPlayerId);
}

/**
 * `DeviceRegistryService` — the Model B registry authority.
 *
 * Owns per-device register/consent/unregister (never affecting a user's other devices), resolves
 * the consented, non-stale player-id targeting set, marks stale player ids, applies subscription
 * webhooks idempotently, and computes OneSignal segmentation tags. After every registry mutation it
 * best-effort pushes the authoritative state (external-user-id association + tags) to OneSignal so
 * the transport stays synchronized; a sync failure never throws into the caller.
 */
@Injectable()
export class DeviceRegistryService {
  private readonly logger = new Logger(DeviceRegistryService.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly oneSignal: OneSignalClient,
  ) {}

  /** Register/upsert a device, then sync its external-user-id + tags to OneSignal (best-effort). */
  async registerDevice(
    user: User,
    playerId: string,
    platform: string,
    consentGranted: boolean,
  ): Promise<void> {
    await this.repo.upsertDevice({
      userId: user.id,
      platform,
      onesignalPlayerId: playerId,
      consentGranted,
    });
    await this.syncToOneSignal(user, playerId);
  }

  /** Update a single device's consent without affecting other devices; re-sync tags. */
  async updateConsent(user: User, playerId: string, consentGranted: boolean): Promise<void> {
    await this.repo.updateConsent(user.id, playerId, consentGranted);
    await this.syncToOneSignal(user, playerId);
  }

  /** Unregister (hard-delete) a single device without affecting other devices. */
  async unregisterDevice(userId: string, playerId: string): Promise<void> {
    await this.repo.deleteDevice(userId, playerId);
  }

  /** The reconciled per-send targeting set (Model B): consented, non-stale player ids. */
  async resolveConsentedPlayerIds(userId: string): Promise<string[]> {
    return this.repo.resolveConsentedPlayerIds(userId);
  }

  /** True when the recipient has at least one consented, non-stale device. */
  async hasConsentedDevice(userId: string): Promise<boolean> {
    return this.repo.hasConsentedDevice(userId);
  }

  /** Flag a player id OneSignal reported invalid so it is excluded from future targeting. */
  async markStale(playerId: string): Promise<void> {
    await this.repo.markStale(playerId);
  }

  /**
   * Apply a subscription-change webhook idempotently. An unsubscribe or token invalidation marks
   * the device stale (excluded from targeting); a player-id change is handled the same way (the
   * new id re-registers via the client flow). Never throws.
   */
  async applySubscriptionWebhook(event: SubscriptionWebhookEvent): Promise<void> {
    try {
      await this.repo.markStale(event.playerId);
    } catch (error) {
      this.logger.warn(
        `Failed to apply subscription webhook for a device: ${this.safeError(error)}`,
      );
    }
  }

  /**
   * Compute OneSignal segmentation tags from durable user data: role, subscription placeholder,
   * country, language, verified, active role. Contains no secrets/PII beyond coarse segments.
   */
  computeTags(user: User): Record<string, string> {
    return {
      role: (user.activeRole ?? user.roles?.[0] ?? 'none').toString(),
      country: user.country ?? '',
      language: user.language ?? 'en',
      verified: String(user.isEmailVerified === true),
    };
  }

  /** Best-effort push of external-user-id association + tags to OneSignal; never throws. */
  private async syncToOneSignal(user: User, playerId: string): Promise<void> {
    try {
      await this.oneSignal.syncDevice(playerId, user.id, this.computeTags(user));
    } catch (error) {
      this.logger.warn(`OneSignal device sync failed (registry is authoritative): ${this.safeError(error)}`);
    }
  }

  private safeError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
