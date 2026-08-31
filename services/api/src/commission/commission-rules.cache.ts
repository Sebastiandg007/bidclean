import { Injectable, Logger } from '@nestjs/common';
import { CommissionRuleRow } from './commission.types';

/** A loader that returns the full set of currently-active rules from the durable store. */
export type ActiveRulesLoader = () => Promise<CommissionRuleRow[]>;

/**
 * In-memory cache of active commission rules.
 *
 * `activeRules(at)` returns only rules whose window contains `at`
 * (`effective_from <= at < effective_to`, open-ended when effective_to is null) — so
 * future-dated rules are inert until their window opens. The full active set is loaded
 * from the store via the injected loader and refreshed on a TTL interval, on demand
 * (after a local write), and on a distributed invalidation message.
 *
 * On a refresh failure the last good snapshot is retained (logged) — never emptied, which
 * would silently drop configured commission rates back to env defaults.
 */
@Injectable()
export class CommissionRulesCache {
  private readonly logger = new Logger(CommissionRulesCache.name);
  private snapshot: CommissionRuleRow[] = [];
  private loaded = false;
  private loader: ActiveRulesLoader | null = null;

  /** Wire the store loader (called once by the module during bootstrap). */
  setLoader(loader: ActiveRulesLoader): void {
    this.loader = loader;
  }

  /** Active rules whose effective window contains `at`. */
  activeRules(at: Date): CommissionRuleRow[] {
    const t = at.getTime();
    return this.snapshot.filter(
      (rule) =>
        rule.isActive &&
        rule.effectiveFrom.getTime() <= t &&
        (rule.effectiveTo === null || t < rule.effectiveTo.getTime()),
    );
  }

  /** Whether the cache has successfully loaded at least once. */
  isReady(): boolean {
    return this.loaded;
  }

  /**
   * Reload the snapshot from the store. On failure, keep the last good snapshot.
   * Returns true when the snapshot was replaced, false when the previous one was kept.
   */
  async refresh(): Promise<boolean> {
    if (!this.loader) {
      this.logger.warn('CommissionRulesCache.refresh called before loader was set');
      return false;
    }
    try {
      const next = await this.loader();
      this.snapshot = next;
      this.loaded = true;
      return true;
    } catch (error) {
      this.logger.error(
        `Commission ruleset refresh failed; retaining last good snapshot (${this.snapshot.length} rules)`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
