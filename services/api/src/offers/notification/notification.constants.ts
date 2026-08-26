/**
 * Notification content constants.
 *
 * All push notification text content is defined here (not hardcoded in logic).
 * Uses i18n key references where possible. When the i18n system is fully integrated,
 * these can be replaced with dynamic translations from the translation service.
 */
export const NOTIFICATION_CONTENT = {
  /** Push notification heading — English */
  NEW_OFFER_HEADING_EN: 'New Cleaning Offer',
  /** Push notification heading — Spanish */
  NEW_OFFER_HEADING_ES: 'Nueva Oferta de Limpieza',
  /** Push notification body — English */
  NEW_OFFER_BODY_EN: 'A new cleaning offer is available near you. Tap to view details.',
  /** Push notification body — Spanish */
  NEW_OFFER_BODY_ES: 'Una nueva oferta de limpieza está disponible cerca de ti. Toca para ver detalles.',
  /** Data type identifier for deep linking */
  OFFER_DATA_TYPE: 'offer_new',
} as const;
