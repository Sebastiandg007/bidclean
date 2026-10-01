import { classify, Classification, VerificationState } from '../video-verification.types';

/**
 * Reload the constants + validator modules with a temporary env + NODE_ENV so the fail-fast
 * validator actually runs (it is skipped under NODE_ENV=test). Restores env after each call.
 */
function runValidatorWith(env: Record<string, string | undefined>): () => void {
  const saved = { ...process.env };
  return () => {
    jest.resetModules();
    process.env = { ...saved, ...env, NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    try {
      const mod = require('../config/validate-video-verification-config');
      mod.validateVideoVerificationConfig();
    } finally {
      process.env = saved;
      jest.resetModules();
    }
  };
}

describe('validateVideoVerificationConfig — fail-fast (P14)', () => {
  const baseValidEnv: Record<string, string> = {
    VIDEO_VERIFICATION_ENABLED: 'true',
    VIDEO_VERIFICATION_MINIO_BUCKET: 'verification-videos',
    VIDEO_VERIFICATION_AI_URL: 'http://ai.internal/verify',
    VIDEO_VERIFICATION_MATCH_THRESHOLD: '0.6',
  };

  it('passes with a valid config', () => {
    expect(runValidatorWith(baseValidEnv)).not.toThrow();
  });

  it('rejects a threshold <= 0', () => {
    expect(runValidatorWith({ ...baseValidEnv, VIDEO_VERIFICATION_MATCH_THRESHOLD: '0' })).toThrow(
      /MATCH_THRESHOLD/,
    );
  });

  it('rejects a threshold > 1', () => {
    expect(runValidatorWith({ ...baseValidEnv, VIDEO_VERIFICATION_MATCH_THRESHOLD: '1.5' })).toThrow(
      /MATCH_THRESHOLD/,
    );
  });

  it('rejects an empty bucket', () => {
    expect(runValidatorWith({ ...baseValidEnv, VIDEO_VERIFICATION_MINIO_BUCKET: '' })).toThrow(
      /MINIO_BUCKET/,
    );
  });

  it('rejects a missing AI URL when enabled', () => {
    expect(runValidatorWith({ ...baseValidEnv, VIDEO_VERIFICATION_AI_URL: '' })).toThrow(/AI_URL/);
  });

  it('rejects a non-positive integer tunable', () => {
    expect(
      runValidatorWith({ ...baseValidEnv, VIDEO_VERIFICATION_MAX_SIZE_BYTES: '0' }),
    ).toThrow(/MAX_SIZE_BYTES/);
  });
});

describe('classify — total state → classification mapping (P13)', () => {
  it('maps every state to exactly one derived classification', () => {
    const expected: Record<VerificationState, Classification> = {
      PENDING_UPLOAD: Classification.UNAVAILABLE,
      UPLOADED: Classification.UNAVAILABLE,
      PROCESSING: Classification.UNAVAILABLE,
      MATCH: Classification.VERIFIED,
      NO_MATCH: Classification.NEEDS_REVIEW,
      INCONCLUSIVE: Classification.NEEDS_REVIEW,
      FAILED: Classification.UNAVAILABLE,
      DISABLED: Classification.UNAVAILABLE,
      EXPIRED: Classification.UNAVAILABLE,
    };
    for (const [state, classification] of Object.entries(expected)) {
      expect(classify(state as VerificationState)).toBe(classification);
    }
  });
});
