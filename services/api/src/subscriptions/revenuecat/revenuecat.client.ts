import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REVENUECAT_API_URL as DEFAULT_API_URL } from '../subscriptions.constants';
import { toEntitlementKey } from './revenuecat.constants';
import { EntitlementKey, Store } from '../subscriptions.types';
import { ReconciledEntitlement } from '../subscriptions.repository';

/** A subscriber snapshot as returned by RevenueCat, normalized for reconciliation. */
export interface RevenueCatSubscriber {
  readonly userId: string;
  readonly entitlements: readonly ReconciledEntitlement[];
}

/**
 * The single network seam to RevenueCat's REST API.
 *
 * This is the ONLY file that calls RevenueCat over the network. It targets a pinned, versioned
 * base URL and can migrate v1->v2 without touching callers. It never throws into a hot path:
 * `getSubscriber` returns null on any failure (reconciliation retries next interval) and
 * `deleteSubscriber` treats 404 as success (idempotent account deletion).
 */
@Injectable()
export class RevenueCatClient {
  private readonly logger = new Logger(RevenueCatClient.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('REVENUECAT_API_KEY', '');
    this.apiUrl = this.configService.get<string>('REVENUECAT_API_URL', DEFAULT_API_URL);
  }

  /**
   * Fetch a subscriber's authoritative entitlement snapshot for reconciliation.
   * Returns null on 404 (unknown subscriber) or any transport/parse error — never throws.
   */
  async getSubscriber(appUserId: string): Promise<RevenueCatSubscriber | null> {
    if (!this.apiKey) {
      this.logger.warn('RevenueCat not configured — cannot fetch subscriber');
      return null;
    }

    try {
      const response = await fetch(`${this.apiUrl}/subscribers/${encodeURIComponent(appUserId)}`, {
        method: 'GET',
        headers: this.authHeaders(),
      });
      if (response.status === 404) {
        return { userId: appUserId, entitlements: [] };
      }
      if (!response.ok) {
        this.logger.warn(`RevenueCat getSubscriber ${appUserId} failed: HTTP ${response.status}`);
        return null;
      }
      const body: unknown = await response.json();
      return { userId: appUserId, entitlements: parseEntitlements(body) };
    } catch (error) {
      this.logger.warn(
        `RevenueCat getSubscriber ${appUserId} threw; treating as unreachable`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  /**
   * Delete a subscriber (account deletion). Idempotent: a 404 is treated as already-deleted.
   * Throws only on an unexpected non-404 error so the deletion cascade can record/retry.
   */
  async deleteSubscriber(appUserId: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn('RevenueCat not configured — skipping subscriber deletion');
      return;
    }

    const response = await fetch(`${this.apiUrl}/subscribers/${encodeURIComponent(appUserId)}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`RevenueCat deleteSubscriber ${appUserId} failed: HTTP ${response.status}`);
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }
}

/** A RevenueCat entitlement object as it appears under `subscriber.entitlements`. */
interface RawEntitlement {
  readonly expires_date?: string | null;
  readonly store?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function toStore(value: unknown): Store | null {
  const known = Object.values(Store) as string[];
  return typeof value === 'string' && known.includes(value) ? (value as Store) : null;
}

/**
 * Parse RevenueCat's `{ subscriber: { entitlements: { <id>: { expires_date, store } } } }`
 * into normalized {@link ReconciledEntitlement}s keyed by logical {@link EntitlementKey}.
 * An entitlement is active when its `expires_date` is null (lifetime) or in the future.
 */
function parseEntitlements(body: unknown): ReconciledEntitlement[] {
  const subscriber = asRecord(asRecord(body)?.subscriber);
  const entitlements = asRecord(subscriber?.entitlements);
  if (!entitlements) {
    return [];
  }

  const result: ReconciledEntitlement[] = [];
  for (const [revenueCatId, rawValue] of Object.entries(entitlements)) {
    const key = toEntitlementKey(revenueCatId);
    if (!key) {
      continue;
    }
    result.push(toReconciledEntitlement(key, rawValue as RawEntitlement));
  }
  return result;
}

function toReconciledEntitlement(
  key: EntitlementKey,
  raw: RawEntitlement,
): ReconciledEntitlement {
  const expiresAt = raw.expires_date ? new Date(raw.expires_date) : null;
  const active = expiresAt === null || expiresAt.getTime() > Date.now();
  return { key, active, expiresAt, store: toStore(raw.store) };
}
