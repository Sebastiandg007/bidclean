# Navigation

## Purpose

Role-based navigation layer for BidClean. After authentication and onboarding, the user's active role determines which tab navigator is rendered. Host and Cleaner have completely separate navigation trees — no shared screens or data.

## Files

| File | Responsibility |
|------|---------------|
| `RoleBasedNavigator.tsx` | Root router — reads active role from store and renders the correct navigator |
| `HostNavigator.tsx` | Host tab navigator: Home, Properties, Activity, Profile (placeholder until Task 16) |
| `CleanerNavigator.tsx` | Cleaner tab navigator: Radar, Active, Profile (placeholder until Task 17) |

## Architecture

```
RoleBasedNavigator
├── activeRole === 'host'    → HostNavigator (4 tabs)
├── activeRole === 'cleaner' → CleanerNavigator (3 tabs)
└── activeRole === null      → Redirect to role selection
```

## Dependencies

- `zustand` — Role state via `useRoleStore` (will merge into auth store in Task 18)
- `expo-router` — Navigation and route redirects
- `react-i18next` — Translations for placeholder text
- `react-native-reanimated` — (future) transition animations between role switches

## Design Decisions

- Navigator map pattern (`NAVIGATOR_BY_ROLE`) avoids if/else chains and is easily extensible
- Loading state during hydration prevents flash of incorrect navigator
- Route redirect (not render) for missing role — ensures proper navigation stack
- `setTimeout(0)` for redirect avoids React state-update-during-render warnings
- Placeholder navigators are simple View components that will be replaced with full tab navigators
