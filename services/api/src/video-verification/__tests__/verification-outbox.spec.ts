import { buildResultOutboxRows } from '../verification-outbox';
import { Decision } from '../video-verification.types';

describe('buildResultOutboxRows — decision-bearing-only emission', () => {
  const base = { verificationId: 'ver-1', serviceSessionId: 'sess-1' };

  it('MATCH emits verification_completed only (with score), no flag', () => {
    const rows = buildResultOutboxRows({ ...base, decision: Decision.MATCH, score: 0.92 });
    expect(rows.map((r) => r.type)).toEqual(['verification_completed']);
    expect(rows[0]?.payload).toMatchObject({ decision: 'MATCH', score: 0.92 });
    expect(rows[0]?.eventId).toBe('verification_completed:ver-1');
  });

  it('NO_MATCH emits verification_completed + verification_flagged', () => {
    const rows = buildResultOutboxRows({ ...base, decision: Decision.NO_MATCH, score: 0.2 });
    expect(rows.map((r) => r.type).sort()).toEqual([
      'verification_completed',
      'verification_flagged',
    ]);
  });

  it('INCONCLUSIVE emits verification_completed + verification_flagged', () => {
    const rows = buildResultOutboxRows({ ...base, decision: Decision.INCONCLUSIVE, score: null });
    expect(rows.map((r) => r.type).sort()).toEqual([
      'verification_completed',
      'verification_flagged',
    ]);
  });

  it('the flagged payload never carries the raw score', () => {
    const rows = buildResultOutboxRows({ ...base, decision: Decision.NO_MATCH, score: 0.2 });
    const flagged = rows.find((r) => r.type === 'verification_flagged');
    expect(flagged?.payload).not.toHaveProperty('score');
  });
});
