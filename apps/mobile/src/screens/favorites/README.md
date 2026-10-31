# favorites (mobile · Spec 22)

## Purpose

The Host-facing favorites UX: a heart toggle reflecting `is-favorite` (optimistic), a paginated
favorites list (view + remove, with an `unavailable` badge for currently-ineligible Cleaners), and a
FREE-limit banner (+ optional PRO upsell) driven by the backend `422`. Membership authority stays
server-side — the client is convenience only; the list / `is-favorite` reconcile the optimistic state.

## Files

| File | Responsibility |
|------|---------------|
| `favorites.types.ts` | Mobile domain types mirroring the backend (`FavoriteView`, `AddResult`, `FavoritesPage`) |
| `favorites.constants.ts` | `FAVORITES_ENDPOINTS`, i18n keys, BidClean dark tokens (brand hex direct) |
| `favorites.api.ts` | Typed client: `add` (maps `422 → OVER_LIMIT`), `remove`, `list`, `isFavorite`, `aggregateCount` |
| `useFavoritesStore.ts` | Zustand: list + `isFavorite` map; optimistic `toggle` + reconcile + revert; `useHasFavorites` signal |
| `components/FavoriteToggle.tsx` | Heart control reflecting `is-favorite`, optimistic |
| `components/FavoritesLimitBanner.tsx` | FREE-limit message + optional PRO upsell (i18n-driven, no embedded cap) |
| `components/FavoriteCard.tsx` | List item: display + remove + `unavailable` badge |
| `FavoritesListScreen.tsx` | Paginated Host list (view/remove); surfaces the limit banner on `limitReached` |

## Behavior

- `toggle(cleanerId)`: optimistic flip → `add`/`remove` → reconcile via `is-favorite`. On a `422`
  (OVER_LIMIT) it sets `limitReached` (the screen renders `FavoritesLimitBanner`) and reverts; on a
  network error it reverts with a generic i18n error key. A limit rejection does **not** reconcile.
- The list paginates via an opaque keyset cursor (`nextCursor`); `loadMore` appends.
- `useHasFavorites()` supplies the has-favorites signal for the publish "offer to favorites first"
  control (Spec 7 owns that control; favorites only supplies the signal).

## Design tokens

Uses the BidClean brand hex directly in a local `FAVORITES_COLORS` (accent `#00F5D4`, card `#1F2833`,
background `#0B0C10`, text `#FFFFFF`), consistent with the other screens. A later theming pass will
tokenize these.

## i18n

`en`/`es` parity under `i18n/locales/{en,es}/favorites.json` (namespaced `favorites.*`). All copy via
`react-i18next`; a parity test asserts identical key sets.
