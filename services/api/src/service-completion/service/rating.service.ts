import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { buildRatedOutboxRow } from '../completion-outbox';
import {
  SERVICE_RATING_MAX_STARS,
  SERVICE_RATING_MIN_STARS,
} from '../completion.constants';
import {
  COMPLETION_ERROR_MESSAGES,
  RELEASED_STATES,
  RatingRole,
  ServiceRatingView,
} from '../completion.types';
import { CompletionParticipationService } from './completion-participation.service';
import { CompletionRepository, CompletionRow } from '../repository/completion.repository';
import { ServiceRatingRepository } from '../repository/service-rating.repository';

/** The parsed rating submission (stars + optional comment). */
export interface RatingSubmission {
  readonly stars: number;
  readonly comment?: string;
}

/**
 * RatingService — captured, never gating (Spec 20).
 *
 * A rating is accepted iff the completion state ∈ {CONFIRMED, AUTO_RELEASED}, the caller is the
 * corresponding participant, stars ∈ [min,max], and the side is free (`UNIQUE (completion, role)`).
 * It never touches `service_completions.state` or `release_intents` — a release never waits on a
 * rating. Functions ≤30 lines, SRP.
 */
@Injectable()
export class RatingService {
  constructor(
    private readonly repository: CompletionRepository,
    private readonly ratings: ServiceRatingRepository,
    private readonly participation: CompletionParticipationService,
  ) {}

  /** Submit one rating side (idempotent per side via ON CONFLICT). */
  async submitRating(id: string, userId: string, submission: RatingSubmission): Promise<void> {
    const completion = await this.requireParticipant(id, userId);
    if (!(RELEASED_STATES as string[]).includes(completion.state)) {
      throw new ConflictException(COMPLETION_ERROR_MESSAGES.INVALID_STATE);
    }
    this.assertStarsInRange(submission.stars);
    const role = this.resolveRole(userId, completion);
    const rateeId = role === RatingRole.HOST_RATES_CLEANER ? completion.cleaner_id : completion.host_id;
    const inserted = await this.ratings.insertOnePerSide(
      {
        serviceCompletionId: id,
        raterId: userId,
        rateeId: rateeId ?? userId,
        role,
        stars: submission.stars,
        comment: submission.comment ?? null,
      },
      buildRatedOutboxRow(id, role, submission.stars),
    );
    if (!inserted) {
      throw new ConflictException(COMPLETION_ERROR_MESSAGES.RATING_DUPLICATE);
    }
  }

  /** Participant-gated ratings read consistent with the completion's participants. */
  async getRatings(id: string, userId: string): Promise<ServiceRatingView[]> {
    await this.requireParticipant(id, userId);
    const rows = await this.ratings.findByCompletion(id);
    return rows.map((row) => ({
      role: row.role as RatingRole,
      stars: row.stars,
      comment: row.comment,
      createdAt: row.created_at.toISOString(),
    }));
  }

  /** Load the completion + assert the caller is a participant (else 404/403). */
  private async requireParticipant(id: string, userId: string): Promise<CompletionRow> {
    const completion = await this.repository.findById(id);
    if (!completion) {
      throw new NotFoundException(COMPLETION_ERROR_MESSAGES.COMPLETION_NOT_FOUND);
    }
    if (!this.participation.isParticipant(userId, completion)) {
      throw new ForbiddenException(COMPLETION_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
    return completion;
  }

  /** Resolve the rating role from the caller's participation side. */
  private resolveRole(userId: string, completion: CompletionRow): RatingRole {
    return this.participation.isHost(userId, completion)
      ? RatingRole.HOST_RATES_CLEANER
      : RatingRole.CLEANER_RATES_HOST;
  }

  /** Assert stars fall within the configured bounds (else 400). */
  private assertStarsInRange(stars: number): void {
    if (
      !Number.isInteger(stars) ||
      stars < SERVICE_RATING_MIN_STARS ||
      stars > SERVICE_RATING_MAX_STARS
    ) {
      throw new BadRequestException(COMPLETION_ERROR_MESSAGES.RATING_OUT_OF_RANGE);
    }
  }
}
