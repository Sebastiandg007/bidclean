/**
 * Settings types.
 */

/** Valid theme options (matches DB CHECK constraint) */
export type ThemeOption = 'dark' | 'light' | 'system';

/** User settings response */
export interface UserSettingsResponse {
  readonly language: string;
  readonly theme: ThemeOption;
  readonly isPushEnabled: boolean;
  readonly isEmailNotificationsEnabled: boolean;
  readonly isSoundsEnabled: boolean;
}
