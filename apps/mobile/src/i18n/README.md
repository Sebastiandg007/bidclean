# i18n (Internationalization)

## Purpose

Multi-language support using i18next. All user-facing strings are defined here, never hardcoded in components.

## Structure

```
i18n/
├── index.ts          → i18next configuration
├── locales/
│   ├── en/           → English translations
│   │   ├── common.json
│   │   ├── offers.json
│   │   ├── profile.json
│   │   └── ...
│   ├── es/           → Spanish translations
│   ├── fr/           → French translations
│   └── ...
```

## Supported Languages

ES, EN, FR, DE, IT, PT, NL

## Rules

- Keys are namespaced: `offers.card.accept`, `profile.settings.language`.
- Default language detected from device settings.
- User can override in profile settings.
- Pluralization handled by i18next rules.
