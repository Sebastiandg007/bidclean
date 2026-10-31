import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  DISPUTE_ERROR_MESSAGES,
  DisputeResolution,
  DisputeState,
  TERMINAL_DISPUTE_STATES,
} from '../dispute.types';
import { DisputeParticipationService } from './dispute-participation.service';
import { DisputeResolutionService } from './dispute-resolution.service';
import { DisputeRepository, DisputeRow } from '../repository/dispute.repository';

/** The DTO shape for a resolve request (validated by the controller pipe). */
export interface ResolveDisputeCommand {
  readonly resolution: DisputeResolution;
  readonly refundCents?: number;
}

/**
 * DisputeLifecycleService (Spec 21) — the resolver-gated single-winner lifecycle transitions.
 *
 * `moveToUnderReview` is the `OPEN → UNDER_REVIEW` single-winner write (resolver only).
 * `resolve` asserts the resolver, validates the `(resolution, refundCents?)` combination, and
 * delegates the terminal transition + financial intent to `DisputeResolutionService`. A lost race on
 * an already-terminal dispute is mapped to an idempotent `200` (same resolution) or a `409`
 * (terminal-different). Functions ≤30 lines, SRP.
 */
@Injectable()
export class DisputeLifecycleService {
  constructor(
    private readonly repository: DisputeRepository,
    private readonly participation: DisputeParticipationService,
    private readonly resolution: DisputeResolutionService,
  ) {}

  /** Single-winner `OPEN → UNDER_REVIEW` (resolver only). */
  async moveToUnderReview(disputeId: string, resolverId: string): Promise<void> {
    await this.requireResolverOnDispute(disputeId, resolverId);
    await this.repository.transitionState(disputeId, DisputeState.OPEN, DisputeState.UNDER_REVIEW);
  }

  /** Resolve a dispute (resolver only, single-winner + financial intent + outbox). */
  async resolve(
    disputeId: string,
    resolverId: string,
    command: ResolveDisputeCommand,
  ): Promise<void> {
    const dispute = await this.requireResolverOnDispute(disputeId, resolverId);
    const input = this.validateResolution(command);
    const won = await this.resolution.resolve(dispute, resolverId, input);
    if (won) {
      return;
    }
    await this.mapLostRace(disputeId, input.resolution);
  }

  /** Assert the caller is an authorized resolver + return the dispute (404 when unknown). */
  private async requireResolverOnDispute(
    disputeId: string,
    resolverId: string,
  ): Promise<DisputeRow> {
    const dispute = await this.repository.findById(disputeId);
    if (!dispute) {
      throw new NotFoundException(DISPUTE_ERROR_MESSAGES.DISPUTE_NOT_FOUND);
    }
    const isResolver = await this.participation.isResolver(resolverId);
    if (!isResolver) {
      throw new ForbiddenException(DISPUTE_ERROR_MESSAGES.NOT_A_RESOLVER);
    }
    return dispute;
  }

  /** Validate the `(resolution, refundCents?)` combination. */
  private validateResolution(command: ResolveDisputeCommand): {
    resolution: DisputeResolution;
    refundCents: number | null;
  } {
    if (command.resolution === DisputeResolution.PARTIAL) {
      const amount = command.refundCents;
      if (amount === undefined || !Number.isInteger(amount) || amount < 0) {
        throw new BadRequestException(DISPUTE_ERROR_MESSAGES.INVALID_RESOLUTION);
      }
      return { resolution: command.resolution, refundCents: amount };
    }
    return { resolution: command.resolution, refundCents: null };
  }

  /** Map a lost single-winner race: idempotent `200` when the same resolution already landed, else `409`. */
  private async mapLostRace(disputeId: string, resolution: DisputeResolution): Promise<void> {
    const current = await this.repository.findById(disputeId);
    const isTerminal =
      current !== null && (TERMINAL_DISPUTE_STATES as readonly string[]).includes(current.state);
    if (isTerminal && current !== null && current.resolution === resolution) {
      return; // idempotent no-op — the same resolution already landed
    }
    throw new ConflictException(DISPUTE_ERROR_MESSAGES.ALREADY_TERMINAL);
  }
}
