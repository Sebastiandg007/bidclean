/**
 * favorites.constants — Mobile endpoints, i18n keys, and BidClean dark design tokens (Spec 22).
 *
 * Endpoints mirror the backend `favorites` controller. There is NO client-embedded numeric cap: the
 * FREE-limit banner is driven entirely by the backend `422` (OVER_LIMIT) reason, so the message and
 * optional PRO upsell are i18n strings, never a hardcoded number. Nothing security-sensitive lives
 * here.
 *
 * Design tokens reference the shared dark palette primitives (no raw hex here).
 */

import { palette } from '../../theme/primitives';

/** Backend REST endpoints for favorites. */
export const FAVORITES_ENDPOINTS = {
  base: '/favorites',
  favorite: (cleanerId: string): string => `/favorites/${cleanerId}`,
  isFavorite: (cleanerId: string): string => `/favorites/is-favorite/${cleanerId}`,
  aggregateCount: '/favorites/aggregate-count',
} as const;

/** Navigation route name for the Host favorites list screen. */
export const FAVORITES_LIST_SCREEN_ROUTE = 'FavoritesList';

/** BidClean dark design tokens used by the favorites screens (brand hex direct; tokenized later). */
export const FAVORITES_COLORS = {
  ACCENT: palette.mint,
  CARD: palette.surfaceDark,
  BACKGROUND: palette.obsidian,
  TEXT: palette.white,
  TEXT_SECONDARY: palette.textSecondaryDark,
  DANGER: palette.offerDanger,
  BORDER: palette.borderFavorites,
} as const;

/** i18n keys for the favorites UI (en/es in parity). */
export const FAVORITES_I18N_KEYS = {
  LIST_TITLE: 'favorites.list.title',
  LIST_EMPTY: 'favorites.list.empty',
  LIST_LOAD_MORE: 'favorites.list.loadMore',
  TOGGLE_ADD: 'favorites.toggle.add',
  TOGGLE_REMOVE: 'favorites.toggle.remove',
  CARD_REMOVE: 'favorites.card.remove',
  CARD_UNAVAILABLE: 'favorites.card.unavailable',
  LIMIT_TITLE: 'favorites.limit.title',
  LIMIT_MESSAGE: 'favorites.limit.message',
  LIMIT_UPSELL: 'favorites.limit.upsell',
  LIMIT_DISMISS: 'favorites.limit.dismiss',
  ERROR_GENERIC: 'favorites.error.generic',
  ERROR_LIMIT: 'favorites.error.limit',
} as const;
