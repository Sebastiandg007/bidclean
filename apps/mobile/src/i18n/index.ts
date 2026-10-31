/**
 * i18n/index.ts — i18next initialization for the mobile app.
 *
 * Registers the bundled en/es resources under their namespaces and initializes a
 * single i18next instance bound to react-i18next. Importing this module once (from
 * the root layout) guarantees `useTranslation()` always has an initialized
 * instance — without it, screens that call `useTranslation()` render against an
 * uninitialized i18n and can fail to mount.
 *
 * Supported languages: ES, EN (FR/DE/IT/PT/NL to be added as their locale files land).
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './resources.en';
import es from './resources.es';

/** The default/fallback language when no supported language is detected. */
const FALLBACK_LANGUAGE = 'en';

/** Namespace used when a component calls `useTranslation()` without an explicit namespace. */
const DEFAULT_NAMESPACE = 'profile';

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { en, es },
    lng: FALLBACK_LANGUAGE,
    fallbackLng: FALLBACK_LANGUAGE,
    defaultNS: DEFAULT_NAMESPACE,
    ns: Object.keys(en),
    interpolation: { escapeValue: false },
    returnNull: false,
    // Resources are in-memory, so no async backend/suspense is needed.
    react: { useSuspense: false },
  });
}

export default i18n;
