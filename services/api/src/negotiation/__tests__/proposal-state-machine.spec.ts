import * as fc from 'fast-check';
import {
  validateProposalTransition,
  isTerminalProposalStatus,
  PROPOSAL_ALLOWED_TRANSITIONS,
  TERMINAL_PROPOSAL_STATUSES,
} from '../proposal-state-machine';
import { ProposalStatus } from '../negotiation.types';

/**
 * Unit + property-based tests for the proposal state machine.
 *
 * Feature: offer-negotiation
 * Validates Correctness Property P6 (Terminal Immutability) and the allowed
 * transition table.
 */
describe('proposal-state-machine', () => {
  const allStatuses = Object.values(ProposalStatus);

  describe('allowed transitions from PENDING', () => {
    it('permits every documented transition from PENDING', () => {
      for (const target of PROPOSAL_ALLOWED_TRANSITIONS[ProposalStatus.PENDING]) {
        expect(validateProposalTransition(ProposalStatus.PENDING, target).valid).toBe(true);
      }
    });

    it('rejects PENDING -> PENDING (no self-loop)', () => {
      expect(validateProposalTransition(ProposalStatus.PENDING, ProposalStatus.PENDING).valid).toBe(
        false,
      );
    });
  });

  describe('Property P6: Terminal Immutability', () => {
    it('no transition out of any terminal status is allowed', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...TERMINAL_PROPOSAL_STATUSES),
          fc.constantFrom(...allStatuses),
          (from: ProposalStatus, to: ProposalStatus) => {
            expect(validateProposalTransition(from, to).valid).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('isTerminalProposalStatus is true for terminal statuses only', () => {
      expect(isTerminalProposalStatus(ProposalStatus.PENDING)).toBe(false);
      for (const status of TERMINAL_PROPOSAL_STATUSES) {
        expect(isTerminalProposalStatus(status)).toBe(true);
      }
    });
  });

  describe('transition validity matches the allowed table', () => {
    it('validateProposalTransition agrees with PROPOSAL_ALLOWED_TRANSITIONS for all pairs', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...allStatuses),
          fc.constantFrom(...allStatuses),
          (from: ProposalStatus, to: ProposalStatus) => {
            const expected = PROPOSAL_ALLOWED_TRANSITIONS[from].includes(to);
            expect(validateProposalTransition(from, to).valid).toBe(expected);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
