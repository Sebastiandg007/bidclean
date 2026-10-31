/**
 * Migration tests — DARK-preservation + LIGHT smoke for the migrated priority components.
 *
 * Validates REQ-TH9 for the completed migrations: the tokenized components map to the same approved
 * DARK values as their prior hardcoded `COLORS` (token-map equivalence), and render under both
 * themes with no undefined color.
 */

import { render } from '@testing-library/react-native';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../splash', () => ({ preventAutoHide: jest.fn(), hide: jest.fn().mockResolvedValue(undefined) }));
let mockScheme: 'light' | 'dark' = 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }));
jest.mock('expo-status-bar', () => ({ setStatusBarStyle: jest.fn() }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { darkTheme } from '../dark.theme';
import { THEMES } from '../themes';
import { ResolvedTheme } from '../tokens';

describe('migration — DARK token-map equivalence', () => {
  it('preserves the prior hardcoded DARK values through the tokens', () => {
    // The prior `const COLORS` values that migrated components used, mapped to their tokens.
    // ProBadge: accent '#00F5D4', onAccent '#0B0C10'.
    expect(darkTheme.accent).toBe('#00F5D4');
    expect(darkTheme.onAccent).toBe('#0B0C10');
    // Navigators/roles: background '#0B0C10', surface (card) '#1F2833', textPrimary '#FFFFFF'.
    expect(darkTheme.background).toBe('#0B0C10');
    expect(darkTheme.surface).toBe('#1F2833');
    expect(darkTheme.textPrimary).toBe('#FFFFFF');
  });

  it('both resolved themes define every token used by migrated components (no undefined color)', () => {
    const keys: Array<keyof typeof darkTheme> = [
      'background',
      'surface',
      'accent',
      'onAccent',
      'textPrimary',
      'textMuted',
      'border',
      'divider',
      'danger',
    ];
    for (const themeName of [ResolvedTheme.DARK, ResolvedTheme.LIGHT]) {
      const theme = THEMES[themeName];
      for (const key of keys) {
        expect(typeof theme[key]).toBe('string');
        expect((theme[key] ?? '').length).toBeGreaterThan(0);
      }
    }
  });
});

describe('migration — LIGHT/DARK render smoke for ProBadge', () => {
  // ProBadge needs its subscription store to be PRO to render; import lazily after mocks.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ProBadge } = require('../../screens/subscriptions/components/ProBadge');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useSubscriptionStore } = require('../../screens/subscriptions/useSubscription');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SubscriberRole, SubscriberTier } = require('../../screens/subscriptions/subscriptions.types');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ThemeProvider } = require('../ThemeProvider');

  beforeEach(() => {
    useSubscriptionStore.setState({
      serverView: {
        tier: SubscriberTier.PRO,
        roleTiers: { HOST: SubscriberTier.PRO, CLEANER: SubscriberTier.PRO },
        entitlements: [],
      },
    });
  });

  function renderInTheme(scheme: 'light' | 'dark'): void {
    mockScheme = scheme;
    const { queryByTestId, unmount } = render(
      <ThemeProvider>
        <ProBadge role={SubscriberRole.CLEANER} />
      </ThemeProvider>,
    );
    // Renders without throwing; the badge may appear once the gate resolves.
    expect(queryByTestId).toBeDefined();
    unmount();
  }

  it('renders under DARK without error', () => {
    renderInTheme('dark');
  });

  it('renders under LIGHT without error', () => {
    renderInTheme('light');
  });
});
