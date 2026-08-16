---
inclusion: fileMatch
fileMatchPattern: "**/*.tsx,**/mobile/**"
---

# React Native Standards

## Component Structure

- Functional components only (no class components).
- One component per file. File name matches component name: `OfferCard.tsx` exports `OfferCard`.
- Components organized by feature/screen, not by type.

```
screens/radar/
├── RadarScreen.tsx         (screen container — orchestrates)
├── RadarMap.tsx            (map component)
├── OfferCard.tsx           (single offer card)
├── OfferFilters.tsx        (filter controls)
├── useRadarOffers.ts       (custom hook for data logic)
├── radar.types.ts          (types for this screen)
└── README.md
```

## Naming Conventions

- Components: PascalCase (`OfferCard`, `RadarScreen`)
- Hooks: camelCase prefixed with `use` (`useRadarOffers`, `useAuth`)
- Utilities: camelCase (`formatCurrency`, `calculateDistance`)
- Style files: `<component>.styles.ts`
- Type files: `<module>.types.ts`
- Test files: `<component>.test.tsx`
- Constants: `<module>.constants.ts`

## Hooks

- Extract business logic into custom hooks.
- One hook = one concern (`useOffers`, `useLocation`, `useTranslation`).
- Hooks should be testable independently of UI.
- Never put API calls directly in components — always in hooks or services.

## State Management (Zustand)

- One store per domain: `useAuthStore`, `useOffersStore`, `useChatStore`.
- Stores live in `src/stores/<domain>.store.ts`.
- Use selectors to avoid unnecessary re-renders:
  ```typescript
  // Good — only re-renders when `offers` changes
  const offers = useOffersStore((state) => state.offers);

  // Bad — re-renders on any store change
  const store = useOffersStore();
  ```
- Actions defined inside the store, not outside.
- Persist sensitive stores with `zustand/persist` + SecureStore.

## Styling

- Use a theme system (`src/theme/`) with tokens for colors, spacing, typography.
- No inline styles with magic numbers: `{ padding: theme.spacing.md }`.
- StyleSheet.create for static styles (performance).
- Reanimated 3 for animations — no Animated API.
- Never hardcode colors — always reference from theme.

## Performance

- Use `React.memo` for expensive list items.
- Use `useCallback` for functions passed as props.
- Use `useMemo` for expensive computations.
- FlatList with `keyExtractor`, `getItemLayout` when possible.
- Images: use progressive loading, proper caching (expo-image).

## Navigation

- Expo Router or React Navigation with typed routes.
- Screen params are typed — no untyped `params.id`.
- Deep linking configured for all public routes.

## Accessibility

- Every interactive element has an `accessibilityLabel`.
- Every image has an `accessibilityRole` and description.
- Touch targets minimum 44x44 points.
- Color contrast meets WCAG AA (especially mint on dark).

## Internationalization (i18n)

- All user-facing strings go through `i18next` — never hardcoded text.
- Translation keys are namespaced: `offers.card.accept`, `profile.settings.language`.
- Pluralization handled by i18next rules.
- RTL support considered (for future Arabic expansion).
