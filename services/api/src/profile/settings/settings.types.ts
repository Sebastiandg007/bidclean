/**
 * Settings types and constants.
 */

/** Valid theme options (matches DB CHECK constraint) */
export type ThemeOption = 'dark' | 'light' | 'system';

/** Supported language codes for BidClean */
export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl'] as const;

/** Valid theme values (matches DB CHECK constraint) */
export const VALID_THEMES: ThemeOption[] = ['dark', 'light', 'system'];

/** Supported language type (union of supported codes) */
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** User settings response */
export interface UserSettingsResponse {
  readonly language: string;
  readonly theme: ThemeOption;
  readonly isPushEnabled: boolean;
  readonly isEmailNotificationsEnabled: boolean;
  readonly isSoundsEnabled: boolean;
}

/** Default settings values */
export const DEFAULT_SETTINGS = {
  language: 'en',
  theme: 'system' as ThemeOption,
  isPushEnabled: true,
  isEmailNotificationsEnabled: true,
  isSoundsEnabled: true,
} as const;
