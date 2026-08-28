import { ProposalStatus } from './negotiation.types';

/**
 * Proposal state machine (pure).
 *
 * Mirrors the offer state machine's validateTransition pattern. Only PENDING is
 * non-terminal; every other status is terminal and cannot transition further.
 */

/** Allowed transitions from each proposal status */
export const PROPOSAL_ALLOWED_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  [ProposalStatus.PENDING]: [
    ProposalStatus.ACCEPTED,
    ProposalStatus.REJECTED,
    ProposalStatus.COUNTERED,
    ProposalStatus.SUPERSEDED,
    ProposalStatus.EXPIRED,
  ],
  [ProposalStatus.ACCEPTED]: [],
  [ProposalStatus.REJECTED]: [],
  [ProposalStatus.COUNTERED]: [],
  [ProposalStatus.SUPERSEDED]: [],
  [ProposalStatus.EXPIRED]: [],
};

/** Terminal proposal statuses (no further transitions allowed) */
export const TERMINAL_PROPOSAL_STATUSES: ProposalStatus[] = [
  ProposalStatus.ACCEPTED,
  ProposalStatus.REJECTED,
  ProposalStatus.COUNTERED,
  ProposalStatus.SUPERSEDED,
  ProposalStatus.EXPIRED,
];

/** Result of a proposal transition validation */
export interface ProposalTransitionResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/**
 * Validate whether a proposal transition is allowed.
 *
 * @param currentStatus - The proposal's current status
 * @param targetStatus - The desired status
 * @returns Result indicating validity and, if invalid, a reason
 */
export function validateProposalTransition(
  currentStatus: ProposalStatus,
  targetStatus: ProposalStatus,
): ProposalTransitionResult {
  const allowed = PROPOSAL_ALLOWED_TRANSITIONS[currentStatus] ?? [];

  if (!allowed.includes(targetStatus)) {
    return {
      valid: false,
      reason: `Transition from ${currentStatus} to ${targetStatus} is not allowed`,
    };
  }

  return { valid: true };
}

/** Whether a status is terminal (immutable) */
export function isTerminalProposalStatus(status: ProposalStatus): boolean {
  return TERMINAL_PROPOSAL_STATUSES.includes(status);
}
