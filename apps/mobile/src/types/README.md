# Types

## Purpose

Ambient TypeScript declarations (`.d.ts`) for native or third-party modules that lack usable types in this project.

## Files

| File | Responsibility |
|------|---------------|
| `expo-image-picker.d.ts` | `declare module 'expo-image-picker'`: stub types (`ImagePickerResult`, `ImagePickerAsset`, `ImagePickerOptions`, `MediaTypeOptions`, `launchImageLibraryAsync`, `launchCameraAsync`). The package is now installed, so this stub can be removed once the real typings are confirmed to cover current usage. |
| `livekit.d.ts` | Minimal ambient declarations for `@livekit/react-native` and `@livekit/react-native-webrtc`, covering only the API used by the `useLiveKitRoom` hook. Keeps native types out of the Jest/tsc toolchain. |

## Dependencies

- Included through `tsconfig.json` (`src/**/*`).
