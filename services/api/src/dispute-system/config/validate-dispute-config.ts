import {
  DISPUTE_CLEANUP_BATCH_SIZE,
  DISPUTE_CLEANUP_INTERVAL_MS,
  DISPUTE_CREATION_DRAIN_BATCH_SIZE,
  DISPUTE_CREATION_DRAIN_INTERVAL_MS,
  DISPUTE_EVIDENCE_ALLOWED_MIME_TYPES,
  DISPUTE_EVIDENCE_MAX_PER_DISPUTE,
  DISPUTE_EVIDENCE_MAX_SIZE_BYTES,
  DISPUTE_EVIDENCE_MINIO_BUCKET,
  DISPUTE_EVIDENCE_PLAYBACK_URL_TTL_SECONDS,
  DISPUTE_EVIDENCE_RETENTION_AUDIT_BUFFER_MS,
  DISPUTE_EVIDENCE_RETENTION_DAYS,
  DISPUTE_EVIDENCE_UPLOAD_GRANT_TTL_SECONDS,
  DISPUTE_EVIDENCE_UPLOAD_URL_TTL_SECONDS,
  DISPUTE_EVIDENCE_WINDOW_MS,
  DISPUTE_FALLBACK_RESOLUTION,
  DISPUTE_INITIATION_POLICY,
  DISPUTE_INTENT_DRAIN_BATCH_SIZE,
  DISPUTE_INTENT_DRAIN_INTERVAL_MS,
  DISPUTE_INTENT_LEASE_MS,
  DISPUTE_REASON_CODES,
  DISPUTE_RESOLUTION_SLA_MS,
  DISPUTE_SLA_SWEEP_BATCH_SIZE,
  DISPUTE_SLA_SWEEP_INTERVAL_MS,
  DISPUTE_STALE_GRANT_BATCH_SIZE,
  DISPUTE_STALE_GRANT_INTERVAL_MS,
  MS_PER_DAY,
} from '../dispute.constants';
import { DisputeResolution } from '../dispute.types';

/** Valid resolution values for the fallback check. */
const VALID_RESOLUTIONS: readonly string[] = Object.values(DisputeResolution);

/**
 * Fail-fast startup validation for dispute-system configuration (Spec 21).
 *
 * Skipped under NODE_ENV=test (tests inject config directly), consistent with the sibling modules.
 * Throws the full batch of invalid values so a misconfigured deployment never boots — critical
 * because this module drives money movement via Spec 9. Enforces two safety floors beyond
 * positivity: the intent lease must exceed the drain interval (so a live dispatch is never stolen),
 * and the evidence retention horizon must exceed the evidence + resolution windows plus an audit
 * buffer (so evidence needed for an in-flight resolution is never deletable).
 */
export function validateDisputeConfig(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const errors: string[] = [];

  const positiveInts: ReadonlyArray<readonly [string, number]> = [
    ['DISPUTE_EVIDENCE_WINDOW_MS', DISPUTE_EVIDENCE_WINDOW_MS],
    ['DISPUTE_RESOLUTION_SLA_MS', DISPUTE_RESOLUTION_SLA_MS],
    ['DISPUTE_EVIDENCE_MAX_SIZE_BYTES', DISPUTE_EVIDENCE_MAX_SIZE_BYTES],
    ['DISPUTE_EVIDENCE_MAX_PER_DISPUTE', DISPUTE_EVIDENCE_MAX_PER_DISPUTE],
    ['DISPUTE_EVIDENCE_UPLOAD_URL_TTL_SECONDS', DISPUTE_EVIDENCE_UPLOAD_URL_TTL_SECONDS],
    ['DISPUTE_EVIDENCE_PLAYBACK_URL_TTL_SECONDS', DISPUTE_EVIDENCE_PLAYBACK_URL_TTL_SECONDS],
    ['DISPUTE_EVIDENCE_UPLOAD_GRANT_TTL_SECONDS', DISPUTE_EVIDENCE_UPLOAD_GRANT_TTL_SECONDS],
    ['DISPUTE_EVIDENCE_RETENTION_DAYS', DISPUTE_EVIDENCE_RETENTION_DAYS],
    ['DISPUTE_EVIDENCE_RETENTION_AUDIT_BUFFER_MS', DISPUTE_EVIDENCE_RETENTION_AUDIT_BUFFER_MS],
    ['DISPUTE_SLA_SWEEP_INTERVAL_MS', DISPUTE_SLA_SWEEP_INTERVAL_MS],
    ['DISPUTE_SLA_SWEEP_BATCH_SIZE', DISPUTE_SLA_SWEEP_BATCH_SIZE],
    ['DISPUTE_INTENT_DRAIN_INTERVAL_MS', DISPUTE_INTENT_DRAIN_INTERVAL_MS],
    ['DISPUTE_INTENT_DRAIN_BATCH_SIZE', DISPUTE_INTENT_DRAIN_BATCH_SIZE],
    ['DISPUTE_INTENT_LEASE_MS', DISPUTE_INTENT_LEASE_MS],
    ['DISPUTE_CREATION_DRAIN_INTERVAL_MS', DISPUTE_CREATION_DRAIN_INTERVAL_MS],
    ['DISPUTE_CREATION_DRAIN_BATCH_SIZE', DISPUTE_CREATION_DRAIN_BATCH_SIZE],
    ['DISPUTE_CLEANUP_INTERVAL_MS', DISPUTE_CLEANUP_INTERVAL_MS],
    ['DISPUTE_CLEANUP_BATCH_SIZE', DISPUTE_CLEANUP_BATCH_SIZE],
    ['DISPUTE_STALE_GRANT_INTERVAL_MS', DISPUTE_STALE_GRANT_INTERVAL_MS],
    ['DISPUTE_STALE_GRANT_BATCH_SIZE', DISPUTE_STALE_GRANT_BATCH_SIZE],
  ];
  for (const [name, value] of positiveInts) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${name} must be a positive integer, got ${value}`);
    }
  }

  // A lease shorter than the drain interval could let a concurrent pass steal a still-live dispatch.
  if (
    Number.isInteger(DISPUTE_INTENT_LEASE_MS) &&
    Number.isInteger(DISPUTE_INTENT_DRAIN_INTERVAL_MS) &&
    DISPUTE_INTENT_LEASE_MS <= DISPUTE_INTENT_DRAIN_INTERVAL_MS
  ) {
    errors.push(
      'DISPUTE_INTENT_LEASE_MS must be greater than DISPUTE_INTENT_DRAIN_INTERVAL_MS ' +
        `(${DISPUTE_INTENT_LEASE_MS} <= ${DISPUTE_INTENT_DRAIN_INTERVAL_MS})`,
    );
  }

  // Retention floor: evidence must never be deletable before a dispute can terminate + an audit buffer.
  const retentionMs = DISPUTE_EVIDENCE_RETENTION_DAYS * MS_PER_DAY;
  const retentionFloorMs =
    DISPUTE_EVIDENCE_WINDOW_MS + DISPUTE_RESOLUTION_SLA_MS + DISPUTE_EVIDENCE_RETENTION_AUDIT_BUFFER_MS;
  if (Number.isInteger(DISPUTE_EVIDENCE_RETENTION_DAYS) && retentionMs < retentionFloorMs) {
    errors.push(
      `DISPUTE_EVIDENCE_RETENTION_DAYS (${retentionMs}ms) must be >= DISPUTE_EVIDENCE_WINDOW_MS + ` +
        `DISPUTE_RESOLUTION_SLA_MS + DISPUTE_EVIDENCE_RETENTION_AUDIT_BUFFER_MS (${retentionFloorMs}ms)`,
    );
  }

  if (!VALID_RESOLUTIONS.includes(DISPUTE_FALLBACK_RESOLUTION)) {
    errors.push(
      `DISPUTE_FALLBACK_RESOLUTION must be one of ${VALID_RESOLUTIONS.join('/')}, ` +
        `got '${DISPUTE_FALLBACK_RESOLUTION}'`,
    );
  }

  if (DISPUTE_REASON_CODES.length === 0) {
    errors.push('DISPUTE_REASON_CODES must be a non-empty list');
  }

  if (DISPUTE_INITIATION_POLICY.length === 0) {
    errors.push('DISPUTE_INITIATION_POLICY must be a non-empty list');
  }

  if (DISPUTE_EVIDENCE_MINIO_BUCKET.trim().length === 0) {
    errors.push('DISPUTE_EVIDENCE_MINIO_BUCKET must be non-empty');
  }

  if (DISPUTE_EVIDENCE_ALLOWED_MIME_TYPES.length === 0) {
    errors.push('DISPUTE_EVIDENCE_ALLOWED_MIME_TYPES must be a non-empty list');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid dispute-system configuration:\n- ${errors.join('\n- ')}`);
  }
}
