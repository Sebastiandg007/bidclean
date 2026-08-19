# Navigation

## Purpose

Role-based navigation layer for BidClean. After authentication and onboarding, the user's active role determines which tab navigator is rendered. Host and Cleaner have completely separate navigation trees — no shared screens or data.

## Files

| File | Responsibility |
|------|---------------|
| `RoleBasedNavigator.tsx` | Root router — reads active role from store and renders the correct navigator |
| `HostNavigator.tsx` | Host custom tab navigator: Home, Properties, Activity, Profile (fully implemented) |
| `CleanerNavigator.tsx` | Cleaner tab navigator: Radar, Active, Profile (placeholder until Task 17) |

## Architecture

```
RoleBasedNavigator
├── activeRole === 'host'    → HostNavigator (4 tabs)
├── activeRole === 'cleaner' → CleanerNavigator (3 tabs)
└── activeRole === null      → Redirect to role selection
```

### HostNavigator Internal Structure

```
HostNavigator
├── Screen Area (renders active tab's screen content)
│   ├── HomeScreen (placeholder)
│   ├── PropertiesScreen (placeholder)
│   ├── ActivityScreen (placeholder)
│   └── ProfileScreen (placeholder — will contain role switch)
└── HostTabBar (custom bottom tab bar)
    ├── Home tab
    ├── Properties tab
    ├── Activity tab
    └── Profile tab
```

## Dependencies

- `zustand` — Role state via `useRoleStore` (will merge into auth store in Task 18)
- `expo-router` — Navigation and route redirects
- `react-i18next` — Translations for all user-facing text
- `react-native-reanimated` — Spring animations for tab button interactions

## Design Decisions

- Navigator map pattern (`NAVIGATOR_BY_ROLE`) avoids if/else chains and is easily extensible
- Loading state during hydration prevents flash of incorrect navigator
- Route redirect (not render) for missing role — ensures proper navigation stack
- `setTimeout(0)` for redirect avoids React state-update-during-render warnings
- HostNavigator uses a custom tab bar (View + Pressable) instead of @react-navigation/bottom-tabs since it's rendered as a component inside RoleBasedNavigator, not as a file-based route
- Tab definitions are data-driven (array of objects) for easy extensibility
- Animated tab buttons use react-native-reanimated spring physics for tactile feedback
- All text uses i18n keys with defaultValue fallbacks for immediate functionality
- Unicode emoji placeholders for tab icons (will be replaced by custom line icons)
