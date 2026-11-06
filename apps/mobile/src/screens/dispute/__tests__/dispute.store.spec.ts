/**
 * Unit tests for the dispute store (Spec 21 · P14): optimistic evidence reconciled via GET,
 * idempotent state application (never regresses a terminal dispute), never persists a bare object
 * key, no create action. The api layer is mocked (zero real network).
 */

import { useDisputeStore } from '../dispute.store';
import type { Dispute } from '../dispute.types';

jest.mock('../dispute.api', () => ({
  getDisputeRequest: jest.fn(),
  requestUploadRequest: jest.fn(),
  putEvidenceBytes: jest.fn(),
  finalizeUploadRequest: jest.fn(),
  addStructuredEvidenceRequest: jest.fn(),
  getEvidenceUrlRequest: jest.fn(),
}));

import {
  addStructuredEvidenceRequest,
  finalizeUploadRequest,
  getDisputeRequest,
  requestUploadRequest,
} from '../dispute.api';

const mockGet = getDisputeRequest as jest.Mock;
const mockRequestUpload = requestUploadRequest as jest.Mock;
const mockFinalize = finalizeUploadRequest as jest.Mock;
const mockAddStructured = addStructuredEvidenceRequest as jest.Mock;

function dispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'dispute-1',
    serviceCompletionId: 'comp-1',
    offerId: 'offer-1',
    state: 'OPEN',
    phase: 'PRE_RELEASE',
    initiatorRole: 'HOST',
    reasonCode: 'QUALITY_INCOMPLETE',
    resolution: null,
    resolutionRefundCents: null,
    evidenceDeadline: new Date(Date.now() + 172_800_000).toISOString(),
    resolutionDeadline: new Date(Date.now() + 604_800_000).toISOString(),
    resolvedAt: null,
    evidence: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useDisputeStore.getState().reset();
});

describe('dispute.store', () => {
  it('loads the authoritative dispute via GET', async () => {
    mockGet.mockResolvedValueOnce(dispute());
    await useDisputeStore.getState().loadDispute('dispute-1');
    expect(useDisputeStore.getState().dispute?.id).toBe('dispute-1');
    expect(useDisputeStore.getState().error).toBeNull();
  });

  it('surfaces an i18n error key when GET fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'));
    await useDisputeStore.getState().loadDispute('dispute-1');
    expect(useDisputeStore.getState().error).toBe('dispute.loadError');
  });

  it('returns an upload target without persisting the object key as state', async () => {
    useDisputeStore.setState({ dispute: dispute() });
    mockRequestUpload.mockResolvedValueOnce({
      objectKey: 'obj-1',
      uploadUrl: 'https://minio/put/obj-1',
      expiresAt: new Date().toISOString(),
    });
    const target = await useDisputeStore.getState().requestUpload('dispute-1');
    expect(target?.objectKey).toBe('obj-1');
    // The store never holds a bare object key in durable state.
    const snapshot = JSON.stringify(useDisputeStore.getState().dispute);
    expect(snapshot).not.toContain('obj-1');
  });

  it('does not request an upload for a terminal dispute', async () => {
    useDisputeStore.setState({ dispute: dispute({ state: 'RESOLVED', resolution: 'FAVOR_HOST' }) });
    const target = await useDisputeStore.getState().requestUpload('dispute-1');
    expect(target).toBeNull();
    expect(mockRequestUpload).not.toHaveBeenCalled();
  });

  it('finalizes then reconciles via GET', async () => {
    mockFinalize.mockResolvedValueOnce(undefined);
    mockGet.mockResolvedValueOnce(dispute({ evidence: [{ id: 'e1', kind: 'HOST_PHOTO', submittedBy: 'host', createdAt: 'now' }] }));
    await useDisputeStore.getState().finalizeUpload('dispute-1', 'obj-1');
    expect(mockFinalize).toHaveBeenCalledWith('dispute-1', 'obj-1');
    expect(useDisputeStore.getState().dispute?.evidence).toHaveLength(1);
  });

  it('adds a structured note then reconciles via GET', async () => {
    mockAddStructured.mockResolvedValueOnce(undefined);
    mockGet.mockResolvedValueOnce(dispute());
    await useDisputeStore.getState().addStructuredEvidence('dispute-1', 'NOTE', 'a note');
    expect(mockAddStructured).toHaveBeenCalledWith('dispute-1', 'NOTE', 'a note');
  });

  it('keeps existing state when reconcile fails (best-effort)', async () => {
    useDisputeStore.setState({ dispute: dispute() });
    mockGet.mockRejectedValueOnce(new Error('offline'));
    await useDisputeStore.getState().reconcile('dispute-1');
    expect(useDisputeStore.getState().dispute?.id).toBe('dispute-1');
  });
});
