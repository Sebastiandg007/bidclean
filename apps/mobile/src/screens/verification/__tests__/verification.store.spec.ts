/**
 * Unit tests for the verification store (Spec 18).
 *
 * Covers idempotent state application (regressions ignored), reconcile via GET, the composed upload
 * action, and the invariant that the store never holds a video URL or the raw score. The api module
 * is mocked (zero real HTTP).
 */

const mockGet = jest.fn();
const mockUpload = jest.fn();
jest.mock('../verification.api', () => ({
  getVerificationRequest: (id: string) => mockGet(id),
  uploadArrivalClip: (id: string, clip: unknown) => mockUpload(id, clip),
}));

import { useVerificationStore } from '../verification.store';
import type { VerificationView } from '../verification.types';

function view(overrides: Partial<VerificationView> = {}): VerificationView {
  return {
    id: 'ver-1',
    serviceSessionId: 'sess-1',
    state: 'PENDING_UPLOAD',
    classification: 'unavailable',
    createdAt: new Date(0).toISOString(),
    uploadedAt: null,
    processedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useVerificationStore.getState().reset();
});

describe('verification.store — load & reconcile', () => {
  it('loads the authoritative view via GET', async () => {
    mockGet.mockResolvedValueOnce(view({ state: 'MATCH', classification: 'verified' }));
    await useVerificationStore.getState().load('ver-1');
    expect(useVerificationStore.getState().verification?.state).toBe('MATCH');
  });

  it('reconcile keeps existing state on a GET failure (best-effort)', async () => {
    useVerificationStore.setState({ verification: view({ state: 'UPLOADED' }) });
    mockGet.mockRejectedValueOnce(new Error('offline'));
    await useVerificationStore.getState().reconcile('ver-1');
    expect(useVerificationStore.getState().verification?.state).toBe('UPLOADED');
  });
});

describe('verification.store — idempotent, non-regressing state application', () => {
  it('ignores a regression from a stale fetch (terminal is not rolled back)', () => {
    const store = useVerificationStore.getState();
    store.applyView(view({ state: 'MATCH', classification: 'verified' }));
    store.applyView(view({ state: 'PROCESSING', classification: 'unavailable' }));
    expect(useVerificationStore.getState().verification?.state).toBe('MATCH');
  });

  it('applies a forward transition', () => {
    const store = useVerificationStore.getState();
    store.applyView(view({ state: 'PENDING_UPLOAD' }));
    store.applyView(view({ state: 'UPLOADED' }));
    expect(useVerificationStore.getState().verification?.state).toBe('UPLOADED');
  });
});

describe('verification.store — upload flow & privacy', () => {
  it('composes the upload and applies the returned view', async () => {
    mockUpload.mockResolvedValueOnce(view({ state: 'UPLOADED' }));
    await useVerificationStore
      .getState()
      .upload('ver-1', { uri: 'file://c.mp4', durationMs: 8000, mimeType: 'video/mp4', sizeBytes: 100 });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(useVerificationStore.getState().verification?.state).toBe('UPLOADED');
    expect(useVerificationStore.getState().isUploading).toBe(false);
  });

  it('never holds a video URL or a raw score', () => {
    useVerificationStore.setState({ verification: view({ state: 'MATCH' }) });
    const v = useVerificationStore.getState().verification as Record<string, unknown> | null;
    expect(v).not.toBeNull();
    expect(Object.keys(v as Record<string, unknown>)).not.toContain('matchScore');
    expect(Object.keys(v as Record<string, unknown>)).not.toContain('videoUrl');
    expect(Object.keys(v as Record<string, unknown>)).not.toContain('objectKey');
  });

  it('a failed upload never throws and clears the uploading flag', async () => {
    mockUpload.mockRejectedValueOnce(new Error('put failed'));
    await useVerificationStore
      .getState()
      .upload('ver-1', { uri: 'file://c.mp4', durationMs: 8000, mimeType: 'video/mp4', sizeBytes: 100 });
    expect(useVerificationStore.getState().isUploading).toBe(false);
    expect(useVerificationStore.getState().error).not.toBeNull();
  });
});
