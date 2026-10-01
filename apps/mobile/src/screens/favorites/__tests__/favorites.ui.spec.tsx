/**
 * Unit tests for the favorites components + screen + i18n parity (Spec 22).
 *
 * Covers: the FavoriteToggle heart reflecting is-favorite; the limit banner + optional PRO upsell;
 * the FavoriteCard remove + unavailable badge; the list screen rendering paginated items and the
 * empty state; en/es i18n parity. react-i18next returns keys (stable assertions); the store api is
 * mocked (render only, zero external calls).
 */

const stableT = (key: string): string => key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: stableT }) }));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View };
});

jest.mock('../favorites.api', () => ({
  addFavoriteRequest: jest.fn(),
  removeFavoriteRequest: jest.fn(),
  listFavoritesRequest: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  isFavoriteRequest: jest.fn(),
  aggregateCountRequest: jest.fn(),
}));

import { fireEvent, render, screen } from '@testing-library/react-native';

import { FavoriteCard } from '../components/FavoriteCard';
import { FavoriteToggle } from '../components/FavoriteToggle';
import { FavoritesLimitBanner } from '../components/FavoritesLimitBanner';
import { FavoritesListScreen } from '../FavoritesListScreen';
import { useFavoritesStore } from '../useFavoritesStore';
import type { FavoriteView } from '../favorites.types';
import enFavorites from '../../../i18n/locales/en/favorites.json';
import esFavorites from '../../../i18n/locales/es/favorites.json';

function favorite(overrides: Partial<FavoriteView> = {}): FavoriteView {
  return {
    cleanerId: 'c-1',
    displayName: 'Ana',
    avatarUrl: null,
    favoritedAt: new Date().toISOString(),
    unavailable: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useFavoritesStore.getState().reset();
});

describe('FavoriteToggle', () => {
  it('reflects the active state and fires onToggle', () => {
    const onToggle = jest.fn();
    render(<FavoriteToggle isFavorite onToggle={onToggle} />);
    fireEvent.press(screen.getByTestId('favorite-toggle'));
    expect(onToggle).toHaveBeenCalled();
    // Active heart uses the filled glyph.
    expect(screen.getByTestId('favorite-toggle-heart').props.children).toBe('\u2665');
  });

  it('does not fire when disabled', () => {
    const onToggle = jest.fn();
    render(<FavoriteToggle isFavorite={false} disabled onToggle={onToggle} />);
    fireEvent.press(screen.getByTestId('favorite-toggle'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('FavoritesLimitBanner', () => {
  it('renders the message + dismiss, and the upsell only when a handler is given', () => {
    const onDismiss = jest.fn();
    const onUpsell = jest.fn();
    render(<FavoritesLimitBanner onDismiss={onDismiss} onUpsell={onUpsell} />);
    expect(screen.getByTestId('favorites-limit-banner')).toBeTruthy();
    fireEvent.press(screen.getByTestId('favorites-limit-upsell'));
    expect(onUpsell).toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('favorites-limit-dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('omits the upsell when no handler is given', () => {
    render(<FavoritesLimitBanner onDismiss={jest.fn()} />);
    expect(screen.queryByTestId('favorites-limit-upsell')).toBeNull();
  });
});

describe('FavoriteCard', () => {
  it('shows the unavailable badge and fires remove with the cleaner id', () => {
    const onRemove = jest.fn();
    render(<FavoriteCard favorite={favorite({ unavailable: true })} onRemove={onRemove} />);
    expect(screen.getByTestId('favorite-card-unavailable')).toBeTruthy();
    fireEvent.press(screen.getByTestId('favorite-card-remove-c-1'));
    expect(onRemove).toHaveBeenCalledWith('c-1');
  });

  it('hides the unavailable badge when the cleaner is available', () => {
    render(<FavoriteCard favorite={favorite({ unavailable: false })} onRemove={jest.fn()} />);
    expect(screen.queryByTestId('favorite-card-unavailable')).toBeNull();
  });
});

describe('FavoritesListScreen', () => {
  it('renders the empty state when there are no favorites', () => {
    render(<FavoritesListScreen />);
    expect(screen.getByTestId('favorites-list-empty')).toBeTruthy();
  });

  it('renders the limit banner when the store flags limitReached', () => {
    useFavoritesStore.setState({ limitReached: true, error: 'favorites.error.limit' });
    render(<FavoritesListScreen />);
    expect(screen.getByTestId('favorites-limit-banner')).toBeTruthy();
  });

  it('renders favorite cards for loaded items', () => {
    useFavoritesStore.setState({
      items: [favorite({ cleanerId: 'c-9', displayName: 'Bea' })],
      isFavoriteMap: { 'c-9': true },
    });
    render(<FavoritesListScreen />);
    expect(screen.getByTestId('favorite-card-c-9')).toBeTruthy();
  });
});

describe('favorites i18n parity', () => {
  function leafKeys(obj: unknown, prefix = ''): string[] {
    if (typeof obj !== 'object' || obj === null) {
      return [prefix];
    }
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      leafKeys(value, prefix ? `${prefix}.${key}` : key),
    );
  }

  it('en and es favorites blocks have identical key sets', () => {
    const en = (enFavorites as { favorites: unknown }).favorites;
    const es = (esFavorites as { favorites: unknown }).favorites;
    expect(leafKeys(en).sort()).toEqual(leafKeys(es).sort());
  });
});
