import { Injectable } from '@nestjs/common';

import { ServiceSessionRepository } from './service-session.repository';
import { EligibilityConfig, GeofenceResult, PositionSample } from './service-tracking.types';

/**
 * GeofenceService — the pure eligibility gate + the PostGIS arrival decision (Spec 17).
 *
 * The server owns the geofence COMPUTATION (a client cannot directly set ARRIVED), but reported
 * coordinates are client telemetry, not cryptographic proof of physical presence — anti-spoofing
 * is out of scope (see the requirements' threat model; human presence is complemented by Spec 18).
 *
 * `accuracy` is an ELIGIBILITY GATE ONLY: a sample is rejected when `accuracy > maxAccuracyM`, but
 * `accuracy` is NEVER used to widen, narrow, or correct the geofence radius. Correspondingly,
 * `distanceM` is the geometric geodesic distance, not an error-bounded distance (an accepted MVP
 * simplification, documented rather than corrected).
 */
@Injectable()
export class GeofenceService {
  constructor(private readonly repository: ServiceSessionRepository) {}

  /**
   * A sample is eligible iff its reported accuracy is within bounds AND it is neither too old nor
   * future-dated beyond the tolerated clock skew. Pure and unit/property-testable.
   *   eligible ⇔ accuracy ≤ maxAccuracyM
   *             AND (serverNow − at) ≤ maxAgeMs
   *             AND at ≤ serverNow + maxClockSkewMs   (rejects future-dated samples)
   */
  isEligible(sample: PositionSample, serverNow: number, config: EligibilityConfig): boolean {
    if (!Number.isFinite(sample.accuracy) || sample.accuracy > config.maxAccuracyM) {
      return false;
    }
    if (!Number.isFinite(sample.at)) {
      return false;
    }
    const age = serverNow - sample.at;
    if (age > config.maxAgeMs) {
      return false;
    }
    if (sample.at > serverNow + config.maxClockSkewMs) {
      return false;
    }
    return true;
  }

  /**
   * The PostGIS arrival check over the session's SNAPSHOT (not the live property row): whether the
   * reported point is within `radiusM` and the geodesic distance. Returns null when the snapshot is
   * unusable (no session / no point) so the caller can decide (the sweep expires such a session).
   */
  async isWithinGeofence(
    sessionId: string,
    sample: PositionSample,
    radiusM: number,
  ): Promise<GeofenceResult | null> {
    return this.repository.evaluateGeofence(sessionId, sample.lng, sample.lat, radiusM);
  }
}
