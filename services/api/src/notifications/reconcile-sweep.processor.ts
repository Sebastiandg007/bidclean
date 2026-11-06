import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { NotificationsRepository } from './notifications.repository';
import { DeviceRegistryService } from './device-registry.service';
import { OneSignalClient } from './onesignal/onesignal.client';
import {
  NOTIFICATIONS_RECONCILE_BATCH_SIZE,
  NOTIFICATIONS_RECONCILE_INTERVAL_MS,
} from './notifications.constants';

/**
 * `ReconcileSweepProcessor` — bounded, periodic registry <-> OneSignal drift repair.
 *
 * Each sweep re-pushes the authoritative state (external-user-id association + tags) of a bounded
 * batch of consented, non-stale devices to OneSignal, keeping the transport synchronized so a send
 * never targets a stale player id and a consented device is never silently unreachable. Deeper
 * OneSignal-side drift detection (subscriptions present in OneSignal but absent from the registry)
 * plugs into this same seam. Best-effort — a failure is logged and retried next interval.
 */
@Injectable()
export class ReconcileSweepProcessor {
  private readonly logger = new Logger(ReconcileSweepProcessor.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly registry: DeviceRegistryService,
    private readonly oneSignal: OneSignalClient,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** Sweep interval resolved from configuration. */
  static getInterval(): number {
    return NOTIFICATIONS_RECONCILE_INTERVAL_MS;
  }

  @Interval(ReconcileSweepProcessor.getInterval())
  async sweep(): Promise<void> {
    try {
      await this.reconcileBatch();
    } catch (error) {
      this.logger.warn(
        `Reconciliation sweep failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /** Re-push a bounded batch of consented devices' authoritative state to OneSignal. */
  async reconcileBatch(): Promise<void> {
    const devices = await this.repo.findDevicesForReconciliation(NOTIFICATIONS_RECONCILE_BATCH_SIZE);
    if (devices.length === 0) {
      return;
    }

    // Batch-load the owning users once (avoid N+1).
    const userIds = [...new Set(devices.map((device) => device.userId))];
    const users = await this.userRepository.find({ where: { id: In(userIds) } });
    const usersById = new Map(users.map((user) => [user.id, user]));

    for (const device of devices) {
      const user = usersById.get(device.userId);
      if (!user) {
        continue;
      }
      await this.oneSignal.syncDevice(
        device.onesignalPlayerId,
        user.id,
        this.registry.computeTags(user),
      );
    }
    this.logger.debug(`Reconciled ${devices.length} device(s) to OneSignal`);
  }
}
