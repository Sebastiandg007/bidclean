# i18n (Internationalization)

## Purpose

Multi-language support using i18next. All user-facing strings are defined here, never hardcoded in components.

## Files

| File | Responsibility |
|------|---------------|
| `index.ts` | Initializes the single i18next instance (`initReactI18next`) once, guarded by `i18n.isInitialized`. Resources `{ en, es }`, `lng` and `fallbackLng` `en`, `defaultNS` `profile`, `ns` from the resource keys, `useSuspense: false` (in-memory resources). Imported from `app/_layout.tsx` inside a `try/catch` so an i18n failure cannot blank the app. |
| `resources.en.ts` | Imports every English namespace JSON and exports them as one object (17 namespaces). Add an import and entry when a locale file is added. |
| `resources.es.ts` | Same for Spanish. |
| `locales/<lang>/<namespace>.json` | Translations. 17 namespaces per language: appearance, chat, checklist, completion, dispute, favorites, kyc, negotiation, notifications, offers, payments, profile, properties, radar, subscriptions, tracking, verification. |

## Structure

```
i18n/
├── index.ts
├── resources.en.ts
├── resources.es.ts
└── locales/
    ├── en/   → appearance.json, chat.json, ... verification.json (17 files)
    └── es/   → same 17 files
```

## Supported Languages

Implemented: EN, ES. Target: ES, EN, FR, DE, IT, PT, NL (the other five are not added yet).

## Rules

- Keys are namespaced: `offers.card.accept`, `profile.settings.language`.
- The initial language is `en` (also the fallback). Detection from device settings and a user override in profile settings are not wired in `index.ts` yet.
- Pluralization is handled by i18next rules.
- A new namespace needs a JSON file in each language folder plus an import and entry in both `resources.*.ts` files.

## Dependencies

- `i18next`, `react-i18next`.
