/**
 * resources.es.ts — Spanish translation bundle.
 *
 * Aggregates every Spanish namespace JSON into one object keyed by namespace, so
 * i18next can register them synchronously at init. Add a new import + entry here
 * when a new namespace locale file is added under `locales/es/`.
 */

import appearance from './locales/es/appearance.json';
import chat from './locales/es/chat.json';
import checklist from './locales/es/checklist.json';
import completion from './locales/es/completion.json';
import dispute from './locales/es/dispute.json';
import favorites from './locales/es/favorites.json';
import kyc from './locales/es/kyc.json';
import negotiation from './locales/es/negotiation.json';
import notifications from './locales/es/notifications.json';
import offers from './locales/es/offers.json';
import payments from './locales/es/payments.json';
import profile from './locales/es/profile.json';
import properties from './locales/es/properties.json';
import radar from './locales/es/radar.json';
import subscriptions from './locales/es/subscriptions.json';
import tracking from './locales/es/tracking.json';
import verification from './locales/es/verification.json';

const es = {
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

export default es;
