/**
 * tracking.labels — pure mapping from a session state to its i18n label key (Spec 17).
 *
 * Kept pure and separate so both screens and their unit tests share one source of truth for the
 * on-the-way / arrived / started / canceled / expired copy.
 */

import { TRACKING_I18N_KEYS } from './tracking.constants';
import type { SessionState } from './tracking.types';

/** The i18n key for a session state's human label (falls back to MATCHED when unknown/null). */
export function stateLabelKey(state: SessionState | null): string {
  switch (state) {
    case 'EN_ROUTE':
      return TRACKING_I18N_KEYS.STATE_ON_THE_WAY;
    case 'ARRIVED':
      return TRACKING_I18N_KEYS.STATE_ARRIVED;
    case 'IN_PROGRESS':
      return TRACKING_I18N_KEYS.STATE_STARTED;
    case 'CANCELED':
      return TRACKING_I18N_KEYS.STATE_CANCELED;
    case 'EXPIRED':
      return TRACKING_I18N_KEYS.STATE_EXPIRED;
    case 'MATCHED':
    default:
      return TRACKING_I18N_KEYS.STATE_MATCHED;
  }
}
