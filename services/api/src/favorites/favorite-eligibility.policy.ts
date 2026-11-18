import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import { FAVORITES_ALLOW_ADD_WITHOUT_SERVICE, FAVORITES_ERROR_MESSAGES, QUALIFYING_SERVICE_QUERY } from './favorites.constants';
import { QualifyingServiceQuery } from './favorites.types';

/**
 * FavoriteEligibilityPolicy — the config-driven add gate (Spec 22, Property 12).
 *
 * The single place `FAVORITES_ALLOW_ADD_WITHOUT_SERVICE` actually drives a decision. When the flag
 * is `true` the check is a constant allow (no external read). When `false`, favorites CONSULTS the
 * Spec 20 qualifying-service predicate `hasQualifyingService(hostId, cleanerId)` and rejects with
 * `422` when it is `false` — favorites reads the predicate, it never owns or re-derives completion
 * logic. The decision is deterministic in `(flag, hasQualifyingService(host, cleaner))`.
 */
@Injectable()
export class FavoriteEligibilityPolicy {
  constructor(
    @Inject(QUALIFYING_SERVICE_QUERY)
    private readonly qualifyingService: QualifyingServiceQuery,
  ) {}

  /**
   * Assert the Host may add this Cleaner. Allows unconditionally when the flag is `true`; otherwise
   * requires a prior qualifying service (read through the Spec 20 predicate), rejecting `422`.
   */
  async assertMayAdd(hostId: string, cleanerId: string): Promise<void> {
    if (FAVORITES_ALLOW_ADD_WITHOUT_SERVICE) {
      return;
    }
    const allowed = await this.qualifyingService.hasQualifyingService(hostId, cleanerId);
    if (!allowed) {
      throw new UnprocessableEntityException(FAVORITES_ERROR_MESSAGES.QUALIFYING_SERVICE_REQUIRED);
    }
  }
}

/**
 * The default seam binding for the Spec 20 qualifying-service predicate. It always resolves `false`
 * (no qualifying service known to favorites). This is only reached when
 * `FAVORITES_ALLOW_ADD_WITHOUT_SERVICE === false` AND the real service-completion predicate has not
 * been wired — in which case an add correctly fails closed (`422`) rather than silently allowing.
 * The orchestrator wires the real Spec 20 implementation (see WIRING).
 */
@Injectable()
export class DenyQualifyingServiceQuery implements QualifyingServiceQuery {
  async hasQualifyingService(_hostId: string, _cleanerId: string): Promise<boolean> {
    return false;
  }
}
