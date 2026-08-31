import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PaymentsRepository } from '../payments.repository';
import { EscrowReleaseService } from '../escrow/escrow-release.service';
import { ESCROW_AUTO_RELEASE_HOURS, PAYMENTS_AUTO_RELEASE_SWEEP_MS } from '../payments.constants';
import { ReleaseReason } from '../payments.types';

/**
 * Auto-release worker.
 *
 * Periodically releases HELD, non-disputed payments whose hold window has elapsed
 * (`held_at + ESCROW_AUTO_RELEASE_HOURS < NOW()`). Disputed payments are excluded by
 * the repository query / partial index (P5). Errors per payment are logged, not thrown.
 */
@Injectable()
export class AutoReleaseWorker {
  private readonly logger = new Logger(AutoReleaseWorker.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly release: EscrowReleaseService,
  ) {}

  /** Sweep interval resolved from configuration. */
  static getInterval(): number {
    return PAYMENTS_AUTO_RELEASE_SWEEP_MS;
  }

  /** Release escrows past the auto-release window. */
  @Interval(AutoReleaseWorker.getInterval())
  async sweep(): Promise<void> {
    try {
      const due = await this.repo.findPaymentsForAutoRelease(ESCROW_AUTO_RELEASE_HOURS);
      for (const payment of due) {
        try {
          await this.release.release(payment.id, ReleaseReason.AUTO_RELEASE);
        } catch (error) {
          this.logger.error(`Auto-release failed for payment ${payment.id}: ${String(error)}`);
        }
      }
      if (due.length > 0) {
        this.logger.debug(`Auto-release swept ${due.length} payment(s)`);
      }
    } catch (error) {
      this.logger.error(`Auto-release sweep failed: ${String(error)}`);
    }
  }
}
