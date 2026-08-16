# @bidclean/mobile

## Purpose

BidClean mobile application for iOS, Android, and Samsung Galaxy Store. Built with React Native + Expo. Single codebase serving both Host and Cleaner roles.

## Tech

- **Framework:** React Native + Expo
- **State:** Zustand
- **Navigation:** Expo Router
- **Animations:** Reanimated 3 + Gesture Handler
- **Maps:** @rnmapbox/maps
- **Notifications:** react-native-onesignal
- **Purchases:** react-native-purchases (RevenueCat)
- **i18n:** i18next + react-i18next

## Structure

```
src/
├── screens/       → Feature-based screens
├── components/    → Reusable UI components
├── stores/        → Zustand state stores
├── services/      → External service integrations
├── hooks/         → Custom React hooks
├── theme/         → Design tokens (colors, typography, spacing)
├── i18n/          → Translations
└── utils/         → Pure utility functions
```

## How to Run

```bash
cd apps/mobile
npm install
npx expo start
```

## Testing

```bash
npm test              # Unit tests
npm run test:e2e      # E2E with Detox/Maestro
```
