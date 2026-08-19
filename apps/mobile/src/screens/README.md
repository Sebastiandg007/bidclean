# Screens

## Purpose

Feature-based screen components. Each subfolder represents a screen or screen group in the app, containing the screen component, its sub-components, custom hooks, types, and styles.

## Structure

```
screens/
├── auth/            → Both: login, register, KYC flow
├── roles/           → Both: role selection and onboarding (Host/Cleaner)
├── radar/           → Cleaner: map with nearby offers
├── offer-detail/    → Cleaner: full offer view + accept/counteroffer
├── service-active/  → Both: service in progress (tracking, checklist)
├── properties/      → Host: property list and management
├── publish-offer/   → Host: create and publish a new offer
├── chat/            → Both: real-time translated messaging
└── profile/         → Both: user profile and settings
```

Each screen folder contains:
- `ScreenName.tsx` — Main screen component
- `ComponentName.tsx` — Sub-components specific to this screen
- `useScreenLogic.ts` — Custom hook for business logic
- `screen.types.ts` — Types specific to this screen
- `README.md` — What this screen does
