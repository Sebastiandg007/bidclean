# Navigation

## Purpose

Role-based navigation layer for BidClean. After authentication and onboarding, the user's active role determines which tab navigator is rendered. Host and Cleaner have completely separate navigation trees — no shared screens or data.

## Files

| File | Responsibility |
|------|---------------|
| `RoleBasedNavigator.tsx` | Root router — reads active role from store and renders the correct navigator |
| `HostNavigator.tsx` | Host custom tab navigator: Home, Properties, Activity, Profile (fully implemented) |
| `CleanerNavigator.tsx` | Cleaner custom tab navigator: Radar, Active, Profile (fully implemented) |

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
│   └── ProfileScreen (placeholder + RoleSwitchButton)
└── HostTabBar (custom bottom tab bar)
    ├── Home tab
    ├── Properties tab
    ├── Activity tab
    └── Profile tab
```

### CleanerNavigator Internal Structure

```
CleanerNavigator
├── Screen Area (renders active tab's screen content)
│   ├── RadarScreen (placeholder)
│   ├── ActiveScreen (placeholder)
│   └── ProfileScreen (placeholder + RoleSwitchButton)
└── CleanerTabBar (custom bottom tab bar)
    ├── Radar tab
    ├── Active tab
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
- Both HostNavigator and CleanerNavigator use custom tab bars (View + Pressable) instead of @react-navigation/bottom-tabs since they're rendered as components inside RoleBasedNavigator, not as file-based routes
- Tab definitions are data-driven (array of objects) for easy extensibility
- Animated tab buttons use react-native-reanimated spring physics for tactile feedback
- All text uses i18n keys with defaultValue fallbacks for immediate functionality
- Unicode emoji placeholders for tab icons (will be replaced by custom line icons)
- Both navigators share the same design tokens (dark theme background, card, and accent colors from the design system)

## Tests

| File | Coverage |
|------|----------|
| `__tests__/RoleBasedNavigator.spec.tsx` | Loading state, correct navigator per role, redirect behavior, role switching, separation of experiences (REQ-4) |

## Test IDs

### HostNavigator
- `host-navigator` — Root container
- `host-tab-bar` — Bottom tab bar
- `host-tab-{key}` — Individual tab buttons (home, properties, activity, profile)
- `host-screen-{key}` — Tab screen containers

### CleanerNavigator
- `cleaner-navigator` — Root container
- `cleaner-tab-bar` — Bottom tab bar
- `cleaner-tab-{key}` — Individual tab buttons (radar, active, profile)
- `cleaner-screen-{key}` — Tab screen containers

### RoleSwitchButton
- `role-switch-button` — Switch role button (rendered in Profile tab of both navigators)
