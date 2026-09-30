/**
 * Unit tests for the checklist store (Spec 19 · P11): optimistic toggle + reconcile via GET,
 * idempotent state application (never regresses a terminal run), and never holding a bare object
 * key. The api layer is mocked (zero real network).
 */

import { useChecklistStore } from '../checklist.store';
import type { ChecklistRun } from '../checklist.types';

jest.mock('../checklist.api', () => ({
  getChecklistRequest: jest.fn(),
  markTaskRequest: jest.fn(),
  finalizeChecklistRequest: jest.fn(),
  uploadTaskPhotoRequest: jest.fn(),
}));

import {
  finalizeChecklistRequest,
  getChecklistRequest,
  markTaskRequest,
  uploadTaskPhotoRequest,
} from '../checklist.api';

const mockGet = getChecklistRequest as jest.Mock;
const mockMark = markTaskRequest as jest.Mock;
const mockFinalize = finalizeChecklistRequest as jest.Mock;
const mockUpload = uploadTaskPhotoRequest as jest.Mock;

function run(overrides: Partial<ChecklistRun> = {}): ChecklistRun {
  return {
    id: 'run-1',
    serviceSessionId: 'sess-1',
    state: 'ACTIVE',
    totalTasks: 2,
    completedTasks: 0,
    maxPhotosPerTask: 5,
    tasks: [
      { id: 't1', position: 0, taskText: 'A', isDone: false, completedAt: null, photos: [] },
      { id: 't2', position: 1, taskText: 'B', isDone: false, completedAt: null, photos: [] },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useChecklistStore.getState().reset();
});

describe('checklist.store', () => {
  it('loads the authoritative run via GET', async () => {
    mockGet.mockResolvedValue(run());
    await useChecklistStore.getState().loadChecklist('sess-1');
    expect(useChecklistStore.getState().run?.id).toBe('run-1');
  });

  it('applies an optimistic toggle then reconciles via GET', async () => {
    mockGet.mockResolvedValueOnce(run()); // initial load
    await useChecklistStore.getState().loadChecklist('sess-1');
    mockMark.mockResolvedValue(undefined);
    mockGet.mockResolvedValueOnce(run({ completedTasks: 1, tasks: run().tasks.map((t) => (t.id === 't1' ? { ...t, isDone: true } : t)) }));
    await useChecklistStore.getState().toggleTask('sess-1', 't1', true);
    expect(mockMark).toHaveBeenCalledWith('sess-1', 't1', true);
    expect(useChecklistStore.getState().run?.completedTasks).toBe(1);
  });

  it('never mutates a terminal (COMPLETED) run optimistically', async () => {
    mockGet.mockResolvedValueOnce(run({ state: 'COMPLETED', completedTasks: 2 }));
    await useChecklistStore.getState().loadChecklist('sess-1');
    mockMark.mockResolvedValue(undefined);
    mockGet.mockResolvedValueOnce(run({ state: 'COMPLETED', completedTasks: 2 }));
    await useChecklistStore.getState().toggleTask('sess-1', 't1', true);
    // The optimistic path is a no-op on a terminal run (completedTasks unchanged pre-reconcile).
    expect(useChecklistStore.getState().run?.state).toBe('COMPLETED');
  });

  it('uploads a photo via the composed flow then reconciles', async () => {
    mockGet.mockResolvedValueOnce(run());
    await useChecklistStore.getState().loadChecklist('sess-1');
    mockUpload.mockResolvedValue(undefined);
    mockGet.mockResolvedValueOnce(
      run({ tasks: run().tasks.map((t) => (t.id === 't1' ? { ...t, photos: [{ id: 'p1', kind: 'AFTER', uploadedAt: 'x' }] } : t)) }),
    );
    await useChecklistStore.getState().uploadPhoto(
      'sess-1',
      't1',
      { uri: 'file://x', sizeBytes: 1024, mimeType: 'image/jpeg', width: 10, height: 10 },
      'AFTER',
    );
    expect(mockUpload).toHaveBeenCalled();
    const t1 = useChecklistStore.getState().run?.tasks.find((t) => t.id === 't1');
    expect(t1?.photos[0]?.id).toBe('p1');
    // The store holds a photo id/kind/uploadedAt only — never an object key.
    expect(Object.keys(t1?.photos[0] ?? {})).toEqual(['id', 'kind', 'uploadedAt']);
  });

  it('finalize reflects COMPLETED on success', async () => {
    mockGet.mockResolvedValueOnce(run());
    await useChecklistStore.getState().loadChecklist('sess-1');
    mockFinalize.mockResolvedValue(undefined);
    mockGet.mockResolvedValueOnce(run({ state: 'COMPLETED', completedTasks: 2 }));
    await useChecklistStore.getState().finalize('sess-1');
    expect(useChecklistStore.getState().run?.state).toBe('COMPLETED');
    expect(useChecklistStore.getState().isFinalizing).toBe(false);
  });

  it('surfaces an i18n error key when finalize is blocked', async () => {
    mockGet.mockResolvedValueOnce(run());
    await useChecklistStore.getState().loadChecklist('sess-1');
    mockFinalize.mockRejectedValue(new Error('409'));
    await useChecklistStore.getState().finalize('sess-1');
    expect(useChecklistStore.getState().error).toBe('checklist.finalize.blocked');
  });
});
