/**
 * Unit tests for the completion store (Spec 20 · P11): optimistic confirm/dispute reconciled via
 * GET, idempotent state application (never regresses a terminal completion), and the Cleaner
 * release/pending-payout/disputed view driven by the server-derived releaseStatus. The api layer is
 * mocked (zero real network).
 */

import { useCompletionStore } from '../completion.store';
import type { ServiceCompletion } from '../completion.types';

jest.mock('../completion.api', () => ({
  getCompletionRequest: jest.fn(),
  confirmCompletionRequest: jest.fn(),
  disputeCompletionRequest: jest.fn(),
  postReleaseDisputeRequest: jest.fn(),
  submitRatingRequest: jest.fn(),
  getRatingsRequest: jest.fn(),
}));

import {
  confirmCompletionRequest,
  disputeCompletionRequest,
  getCompletionRequest,
  postReleaseDisputeRequest,
  submitRatingRequest,
} from '../completion.api';

const mockGet = getCompletionRequest as jest.Mock;
const mockConfirm = confirmCompletionRequest as jest.Mock;
const mockDispute = disputeCompletionRequest as jest.Mock;
const mockPostDispute = postReleaseDisputeRequest as jest.Mock;
const mockRate = submitRatingRequest as jest.Mock;

function completion(overrides: Partial<ServiceCompletion> = {}): ServiceCompletion {
  return {
    id: 'comp-1',
    serviceSessionId: 'sess-1',
    offerId: 'offer-1',
    state: 'AWAITING_CONFIRMATION',
    autoReleaseDeadline: new Date(Date.now() + 86_400_000).toISOString(),
    confirmedAt: null,
    releasedTrigger: null,
    disputeId: null,
    postReleaseDisputeId: null,
    releaseStatus: 'NOT_TRIGGERED',
    ratingStatus: { hostRated: false, cleanerRated: false },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useCompletionStore.getState().reset();
});

describe('completion.store', () => {
  it('loads the authoritative completion via GET', async () => {
    mockGet.mockResolvedValue(completion());
    await useCompletionStore.getState().loadCompletion('comp-1');
    expect(useCompletionStore.getState().completion?.id).toBe('comp-1');
  });

  it('applies an optimistic confirm then reconciles via GET (→ CONFIRMED)', async () => {
    mockGet.mockResolvedValueOnce(completion());
    await useCompletionStore.getState().loadCompletion('comp-1');
    mockConfirm.mockResolvedValue(undefined);
    mockGet.mockResolvedValueOnce(completion({ state: 'CONFIRMED', releaseStatus: 'PENDING' }));
    await useCompletionStore.getState().confirm('comp-1');
    expect(mockConfirm).toHaveBeenCalledWith('comp-1');
    expect(useCompletionStore.getState().completion?.state).toBe('CONFIRMED');
  });

  it('applies an optimistic dispute then reconciles via GET (→ DISPUTED)', async () => {
    mockGet.mockResolvedValueOnce(completion());
    await useCompletionStore.getState().loadCompletion('comp-1');
    mockDispute.mockResolvedValue(undefined);
    mockGet.mockResolvedValueOnce(completion({ state: 'DISPUTED', disputeId: 'd-1' }));
    await useCompletionStore.getState().dispute('comp-1');
    expect(useCompletionStore.getState().completion?.state).toBe('DISPUTED');
  });

  it('never mutates a terminal (CONFIRMED) completion optimistically', async () => {
    mockGet.mockResolvedValueOnce(completion({ state: 'CONFIRMED', releaseStatus: 'ACCEPTED' }));
    await useCompletionStore.getState().loadCompletion('comp-1');
    mockDispute.mockResolvedValue(undefined);
    mockGet.mockResolvedValueOnce(completion({ state: 'CONFIRMED', releaseStatus: 'ACCEPTED' }));
    await useCompletionStore.getState().dispute('comp-1');
    // The optimistic path is a no-op on a terminal completion.
    expect(useCompletionStore.getState().completion?.state).toBe('CONFIRMED');
  });

  it('surfaces an i18n error key when an action fails', async () => {
    mockGet.mockResolvedValueOnce(completion());
    await useCompletionStore.getState().loadCompletion('comp-1');
    mockConfirm.mockRejectedValue(new Error('409'));
    mockGet.mockResolvedValueOnce(completion());
    await useCompletionStore.getState().confirm('comp-1');
    expect(useCompletionStore.getState().error).toBe('completion.actionError');
    expect(useCompletionStore.getState().isSubmitting).toBe(false);
  });

  it('post-release dispute + rating reconcile via GET and never gate', async () => {
    mockGet.mockResolvedValueOnce(completion({ state: 'CONFIRMED', releaseStatus: 'ACCEPTED' }));
    await useCompletionStore.getState().loadCompletion('comp-1');
    mockPostDispute.mockResolvedValue(undefined);
    mockRate.mockResolvedValue(undefined);
    mockGet.mockResolvedValue(
      completion({ state: 'CONFIRMED', releaseStatus: 'ACCEPTED', postReleaseDisputeId: 'p-1' }),
    );
    await useCompletionStore.getState().postReleaseDispute('comp-1');
    await useCompletionStore.getState().submitRating('comp-1', 5, 'great');
    expect(mockRate).toHaveBeenCalledWith('comp-1', 5, 'great');
    expect(useCompletionStore.getState().completion?.releaseStatus).toBe('ACCEPTED');
  });
});
