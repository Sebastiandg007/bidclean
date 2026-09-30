import { DISPUTE_INITIATION_POLICY } from '../dispute.constants';
import { DisputeInitiatorRole, DisputePhase } from '../dispute.types';

/**
 * DisputeInitiationPolicy (pure) — the deterministic, config-driven decision over the allowed
 * `(role, reason_code, phase)` initiation combinations (Spec 21, P3).
 *
 * The Host may initiate within the window on a completed/released service; the Cleaner may initiate
 * only a defined payout/non-release grievance and never a service-quality dispute against themselves.
 * The policy is parsed once from `DISPUTE_INITIATION_POLICY` (`ROLE:REASON:PHASE` tuples, `*` = any
 * phase). Server-enforced, never client-asserted. Pure, no I/O.
 */

/** A parsed initiation rule. `phase = null` means the rule matches any phase. */
interface InitiationRule {
  readonly role: string;
  readonly reasonCode: string;
  readonly phase: DisputePhase | null;
}

/** Parse the raw `ROLE:REASON:PHASE` tuples into structured rules (invalid tuples are dropped). */
function parseRules(raw: readonly string[]): readonly InitiationRule[] {
  const rules: InitiationRule[] = [];
  for (const entry of raw) {
    const parts = entry.split(':').map((part) => part.trim());
    const role = parts[0];
    const reasonCode = parts[1];
    const phaseToken = parts[2];
    if (role === undefined || reasonCode === undefined || phaseToken === undefined) {
      continue;
    }
    if (role.length === 0 || reasonCode.length === 0) {
      continue;
    }
    rules.push({ role, reasonCode, phase: normalizePhase(phaseToken) });
  }
  return rules;
}

/** Map a phase token to a `DisputePhase` or `null` (any). Unknown tokens are treated as `null`. */
function normalizePhase(token: string): DisputePhase | null {
  if (token === DisputePhase.PRE_RELEASE || token === DisputePhase.POST_RELEASE) {
    return token;
  }
  return null;
}

/** The parsed rules (module-level, derived once from config). */
const RULES: readonly InitiationRule[] = parseRules(DISPUTE_INITIATION_POLICY);

/**
 * Whether initiation is allowed for the given `(role, reason_code, phase)` under the config policy.
 * A rule matches when role + reason_code match and its phase is either the given phase or `null`.
 */
export function isInitiationAllowed(
  role: DisputeInitiatorRole,
  reasonCode: string,
  phase: DisputePhase,
): boolean {
  return RULES.some(
    (rule) =>
      rule.role === role &&
      rule.reasonCode === reasonCode &&
      (rule.phase === null || rule.phase === phase),
  );
}
