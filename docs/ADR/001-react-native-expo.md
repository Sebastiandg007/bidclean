# ADR-001: React Native + Expo for Mobile Development

## Status
Accepted

## Context
BidClean needs to ship on iOS, Android, and Samsung Galaxy Store. We need a single codebase to avoid maintaining three separate apps. The team uses TypeScript. We need access to native features (maps, camera, biometrics, push notifications) and need to publish to stores.

## Decision
We chose React Native with Expo as the mobile framework.

## Reasoning
- **Single codebase** for iOS + Android + Galaxy Store.
- **TypeScript native** — same language as the NestJS backend, reducing context switching.
- **Expo** simplifies build/deploy (EAS Build) and provides managed native modules.
- **RevenueCat SDK** has official React Native support with Expo compatibility.
- **Mapbox, OneSignal, LiveKit** all have React Native SDKs.
- **Lance** (Ship Kit tool, 3 months free) allows iOS builds from Windows without Xcode.
- **Mature ecosystem** with large community and extensive libraries.

## Alternatives Considered
- **Flutter:** Good performance, but Dart is a different language from the backend (TypeScript). Would require the team to maintain two languages.
- **Kotlin Multiplatform (KMP):** Would qualify for JetBrains $15k prize, but Compose Multiplatform is less mature for iOS, fewer libraries, steeper learning curve for the team.
- **Native (Swift + Kotlin):** Best performance but 2x the work, 2x the codebase.

## Consequences
- We lose eligibility for the "Ship Kotlin Everywhere" JetBrains prize ($15k).
- We gain faster development speed and ecosystem maturity.
- The team can work on frontend and backend with the same language.
- Galaxy Store support via `react-native-purchases-store-galaxy` package.
