/**
 * resources.en.ts — English translation bundle.
 *
 * Aggregates every English namespace JSON into one object keyed by namespace, so
 * i18next can register them synchronously at init. Add a new import + entry here
 * when a new namespace locale file is added under `locales/en/`.
 */

import appearance from './locales/en/appearance.json';
import chat from './locales/en/chat.json';
import checklist from './locales/en/checklist.json';
import completion from './locales/en/completion.json';
import dispute from './locales/en/dispute.json';
import favorites from './locales/en/favorites.json';
import kyc from './locales/en/kyc.json';
import negotiation from './locales/en/negotiation.json';
import notifications from './locales/en/notifications.json';
import offers from './locales/en/offers.json';
import payments from './locales/en/payments.json';
import profile from './locales/en/profile.json';
import properties from './locales/en/properties.json';
import radar from './locales/en/radar.json';
import subscriptions from './locales/en/subscriptions.json';
import tracking from './locales/en/tracking.json';
import verification from './locales/en/verification.json';

const en = {
  appearance,
  chat,
  checklist,
  completion,
  dispute,
  favorites,
  kyc,
  negotiation,
  notifications,
  offers,
  payments,
  profile,
  properties,
  radar,
  subscriptions,
  tracking,
  verification,
} as const;

export default en;
