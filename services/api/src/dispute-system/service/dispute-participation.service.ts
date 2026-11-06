import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../../auth/entities/user.entity';
import { DISPUTE_RESOLVER_ROLE } from '../dispute.constants';
import { DisputeRow } from '../repository/dispute.repository';

/**
 * DisputeParticipationService (Spec 21) — the single source of the authorization rule for every
 * endpoint. `isParticipant` resolves from the dispute's snapshotted `host_id`/`cleaner_id`; a nulled
 * participant (after user deletion) resolves to non-participant for that id while the row is retained
 * (deletion coherence). `isResolver` checks the authorized resolver role on the user. Server-side
 * only; never client-asserted.
 */
@Injectable()
export class DisputeParticipationService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** Whether the user is the dispute's Host or Cleaner (a nulled participant is not one). */
  isParticipant(userId: string, dispute: DisputeRow): boolean {
    return dispute.host_id === userId || dispute.cleaner_id === userId;
  }

  /** Whether the user holds the authorized resolver role. */
  async isResolver(userId: string): Promise<boolean> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      return false;
    }
    return user.roles.includes(DISPUTE_RESOLVER_ROLE);
  }

  /** Whether the user may view the dispute (participant OR resolver). */
  async canView(userId: string, dispute: DisputeRow): Promise<boolean> {
    if (this.isParticipant(userId, dispute)) {
      return true;
    }
    return this.isResolver(userId);
  }
}
