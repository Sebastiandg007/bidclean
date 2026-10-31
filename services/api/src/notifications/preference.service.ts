import { Injectable } from '@nestjs/common';
import { SuppressionReason } from './notifications.types';
import { NotificationTypeMetadata } from './notification-type.registry';

/** The two possible outcomes of a delivery decision. */
export type DeliveryDecision =
  | { readonly kind: 'DELIVER' }
  | { readonly kind: 'SUPPRESS'; readonly reason: SuppressionReason };

/** The subset of a user's preferences the decision needs (already loaded/normalized). */
export interface PreferenceSnapshot {
  /** `{ [category]: false }` overrides; an absent category defers to metadata defaultEnabled. */
  readonly categoryOptOut: Readonly<Record<string, boolean>>;
  /** Local quiet-hours window start "HH:MM"/"HH:MM:SS" (null = disabled). */
  readonly quietHoursStart: string | null;
  /** Local quiet-hours window end. */
  readonly quietHoursEnd: string | null;
  /** IANA timezone for the window (null = disabled). */
  readonly quietHoursTimezone: string | null;
}

/** All inputs to the pure decision. `nowUtcMinutes` is injectable for deterministic tests. */
export interface DecisionInput {
  readonly metadata: NotificationTypeMetadata;
  readonly prefs: PreferenceSnapshot | null;
  readonly hasConsentedDevice: boolean;
  /** True only when foreground status is RELIABLY known to be active (fail-open otherwise). */
  readonly foregroundKnownActive: boolean;
  /** Minutes-since-midnight in the quiet-hours timezone; null when tz cannot be resolved. */
  readonly localNowMinutes: number | null;
}

const DELIVER: DeliveryDecision = { kind: 'DELIVER' };

/**
 * `PreferenceService` — the pure delivery-decision function.
 *
 * `decide()` is a total function of `NotificationType` metadata + the user's preferences + device
 * consent + foreground knowledge. It NEVER branches on specific type names: an `EXEMPT`/`HIGH`
 * type (incoming call) bypasses quiet-hours and non-urgent opt-outs but still honors a full device
 * unregister (no consented device). Foreground de-dup is fail-open (suppress only when reliably
 * active). Ordering of checks: no-device first (a full unregister trumps EXEMPT), then EXEMPT
 * short-circuits opt-out/quiet-hours, then category opt-out, then quiet-hours, then foreground.
 */
@Injectable()
export class PreferenceService {
  /** Decide DELIVER vs SUPPRESS(reason). Pure — no I/O, no throw. */
  decide(input: DecisionInput): DeliveryDecision {
    // A full device unregister / no consented device suppresses EVERYTHING, including EXEMPT.
    if (!input.hasConsentedDevice) {
      return suppress(SuppressionReason.NO_DEVICE);
    }

    const isExempt = input.metadata.quietHoursBehavior === 'EXEMPT';

    // EXEMPT/HIGH (incoming call) bypasses non-urgent opt-out + quiet-hours; also always fails open.
    if (isExempt) {
      return DELIVER;
    }

    if (this.isCategoryOptedOut(input)) {
      return suppress(SuppressionReason.OPTED_OUT);
    }

    if (this.isWithinQuietHours(input)) {
      return suppress(SuppressionReason.QUIET_HOURS);
    }

    // Foreground de-dup is fail-open: suppress ONLY when reliably known active.
    if (input.foregroundKnownActive) {
      return suppress(SuppressionReason.FOREGROUND);
    }

    return DELIVER;
  }

  /**
   * A category is opted out only when preferences explicitly set it `false`. An absent override
   * defers to the type's `defaultEnabled` (from metadata) — never a value hardcoded here.
   */
  private isCategoryOptedOut(input: DecisionInput): boolean {
    const { metadata, prefs } = input;
    const override = prefs?.categoryOptOut?.[metadata.category];
    if (override === undefined) {
      return metadata.defaultEnabled === false;
    }
    return override === false;
  }

  /**
   * True when the recipient's local time falls inside the quiet-hours window. Disabled when the
   * window/timezone is absent or the local time could not be resolved (fail-open -> not quiet).
   * Handles windows that wrap past midnight (start > end).
   */
  private isWithinQuietHours(input: DecisionInput): boolean {
    const { prefs, localNowMinutes } = input;
    if (
      !prefs ||
      prefs.quietHoursStart === null ||
      prefs.quietHoursEnd === null ||
      prefs.quietHoursTimezone === null ||
      localNowMinutes === null
    ) {
      return false;
    }
    const start = toMinutes(prefs.quietHoursStart);
    const end = toMinutes(prefs.quietHoursEnd);
    if (start === null || end === null || start === end) {
      return false;
    }
    if (start < end) {
      return localNowMinutes >= start && localNowMinutes < end;
    }
    // Wrapping window (e.g. 22:00 -> 07:00).
    return localNowMinutes >= start || localNowMinutes < end;
  }
}

function suppress(reason: SuppressionReason): DeliveryDecision {
  return { kind: 'SUPPRESS', reason };
}

/** Parse "HH:MM" or "HH:MM:SS" into minutes-since-midnight, or null when malformed. */
export function toMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}
