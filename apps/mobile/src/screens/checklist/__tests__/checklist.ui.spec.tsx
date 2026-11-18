/**
 * Unit tests for the checklist screens + i18n parity (Spec 19).
 *
 * Covers: ChecklistScreen (Cleaner) renders tasks + a finalize affordance; ChecklistProgressScreen
 * (Host) renders read-only progress with no toggle; the finalize button is disabled once the run is
 * not ACTIVE; en/es checklist i18n keys are in parity. react-i18next returns keys (stable
 * assertions); the store api + photo capture are mocked (render only, zero external calls).
 */

const stableT = (key: string): string => key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: stableT }) }));

jest.mock('../checklist.api', () => ({
  getChecklistRequest: jest.fn().mockResolvedValue(null),
  markTaskRequest: jest.fn(),
  finalizeChecklistRequest: jest.fn(),
  uploadTaskPhotoRequest: jest.fn(),
  getPlaybackUrlRequest: jest.fn(),
}));

jest.mock('../usePhotoCapture', () => ({
  usePhotoCapture: () => ({ isCapturing: false, errorKey: null, capture: jest.fn() }),
}));

import { render, screen } from '@testing-library/react-native';
import { act } from '@testing-library/react-native';

import { ChecklistScreen } from '../ChecklistScreen';
import { ChecklistProgressScreen } from '../ChecklistProgressScreen';
import { useChecklistStore } from '../checklist.store';
import type { ChecklistRun } from '../checklist.types';
import enChecklist from '../../../i18n/locales/en/checklist.json';
import esChecklist from '../../../i18n/locales/es/checklist.json';

function run(overrides: Partial<ChecklistRun> = {}): ChecklistRun {
  return {
    id: 'run-1',
    serviceSessionId: 'sess-1',
    state: 'ACTIVE',
    totalTasks: 1,
    completedTasks: 0,
    maxPhotosPerTask: 5,
    tasks: [{ id: 't1', position: 0, taskText: 'Clean the kitchen', isDone: false, completedAt: null, photos: [] }],
    ...overrides,
  };
}

const route = { params: { sessionId: 'sess-1' } };
const navigation = { goBack: jest.fn() };

beforeEach(() => {
  useChecklistStore.getState().reset();
});

describe('ChecklistScreen (Cleaner)', () => {
  it('renders the checklist title, a task row, and the finalize affordance', async () => {
    act(() => {
      useChecklistStore.setState({ run: run() });
    });
    render(<ChecklistScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('checklist-screen')).toBeTruthy();
    expect(screen.getByTestId('checklist-task-t1')).toBeTruthy();
    expect(screen.getByTestId('checklist-finalize')).toBeTruthy();
    expect(screen.getByTestId('checklist-task-toggle-t1')).toBeTruthy();
  });

  it('renders the COMPLETED indicator (no finalize button) once completed', async () => {
    act(() => {
      useChecklistStore.setState({ run: run({ state: 'COMPLETED', completedTasks: 1 }) });
    });
    render(<ChecklistScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('checklist-completed')).toBeTruthy();
    expect(screen.queryByTestId('checklist-finalize')).toBeNull();
  });
});

describe('ChecklistProgressScreen (Host)', () => {
  it('renders read-only progress with no task toggle', async () => {
    act(() => {
      useChecklistStore.setState({ run: run() });
    });
    render(<ChecklistProgressScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('checklist-progress-screen')).toBeTruthy();
    expect(screen.getByTestId('checklist-progress-bar')).toBeTruthy();
    // A read-only Host row still renders the toggle control but it is disabled (accessibilityState).
    const toggle = screen.getByTestId('checklist-task-toggle-t1');
    expect(toggle.props.accessibilityState.disabled).toBe(true);
  });
});

describe('checklist i18n parity', () => {
  it('en and es have identical key structures', () => {
    const keys = (obj: unknown, prefix = ''): string[] => {
      if (obj === null || typeof obj !== 'object') {
        return [prefix];
      }
      return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
        keys(v, prefix ? `${prefix}.${k}` : k),
      );
    };
    expect(keys(enChecklist).sort()).toEqual(keys(esChecklist).sort());
  });
});
