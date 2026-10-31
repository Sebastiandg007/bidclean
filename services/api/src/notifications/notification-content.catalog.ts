import { Injectable, OnModuleInit } from '@nestjs/common';
import { NotificationType } from './notifications.types';

/** Supported content locales (en/es parity is enforced at startup). */
export const CONTENT_LOCALES = ['en', 'es'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

/** A single locale's heading + body template. */
interface LocaleTemplate {
  readonly heading: string;
  readonly body: string;
}

/** Per-type template set (one entry per supported locale). */
type TypeTemplates = Record<ContentLocale, LocaleTemplate>;

/** Rendered content for OneSignal (`headings`/`contents` maps keyed by locale). */
export interface RenderedContent {
  readonly headings: Record<string, string>;
  readonly contents: Record<string, string>;
}

/**
 * Per-type localized content templates. English and Spanish are kept in parity (enforced at
 * startup by {@link NotificationContentCatalog.onModuleInit}). Placeholders like `{amount}` are
 * interpolated from the intent's `payloadRef` (ids/labels only — no sensitive content). None of
 * this text is hardcoded in delivery logic.
 */
const CONTENT_TEMPLATES: Record<NotificationType, TypeTemplates> = {
  [NotificationType.OFFER_MATCHED]: {
    en: { heading: 'Offer matched', body: 'Your cleaning offer has been matched. Tap to view details.' },
    es: { heading: 'Oferta emparejada', body: 'Tu oferta de limpieza fue emparejada. Toca para ver detalles.' },
  },
  [NotificationType.OFFER_CANCELLED]: {
    en: { heading: 'Offer cancelled', body: 'An offer was cancelled. Tap to see what changed.' },
    es: { heading: 'Oferta cancelada', body: 'Una oferta fue cancelada. Toca para ver qué cambió.' },
  },
  [NotificationType.OFFER_EXPIRED]: {
    en: { heading: 'Offer expired', body: 'An offer expired without a match. Tap to review.' },
    es: { heading: 'Oferta expirada', body: 'Una oferta expiró sin emparejarse. Toca para revisar.' },
  },
  [NotificationType.OFFER_COMPLETED]: {
    en: { heading: 'Service completed', body: 'A cleaning service was completed. Tap to view.' },
    es: { heading: 'Servicio completado', body: 'Un servicio de limpieza fue completado. Toca para ver.' },
  },
  [NotificationType.PAYMENT_CAPTURED]: {
    en: { heading: 'Payment held', body: 'A payment is now held in escrow. Tap for details.' },
    es: { heading: 'Pago retenido', body: 'Un pago está retenido en garantía. Toca para más detalles.' },
  },
  [NotificationType.PAYMENT_RELEASED]: {
    en: { heading: 'Payment released', body: 'A payment has been released to you. Tap to view.' },
    es: { heading: 'Pago liberado', body: 'Un pago fue liberado a tu favor. Toca para ver.' },
  },
  [NotificationType.PAYMENT_FAILED]: {
    en: { heading: 'Payment failed', body: 'A payment could not be processed. Tap to resolve.' },
    es: { heading: 'Pago fallido', body: 'No se pudo procesar un pago. Toca para resolver.' },
  },
  [NotificationType.PAYMENT_REFUNDED]: {
    en: { heading: 'Payment refunded', body: 'A payment was refunded. Tap for details.' },
    es: { heading: 'Pago reembolsado', body: 'Un pago fue reembolsado. Toca para más detalles.' },
  },
  [NotificationType.PAYMENT_DISPUTED]: {
    en: { heading: 'Payment disputed', body: 'A payment is under dispute. Tap to respond.' },
    es: { heading: 'Pago en disputa', body: 'Un pago está en disputa. Toca para responder.' },
  },
  [NotificationType.NEGOTIATION_PROPOSAL_CREATED]: {
    en: { heading: 'New proposal', body: 'You received a new proposal. Tap to review.' },
    es: { heading: 'Nueva propuesta', body: 'Recibiste una nueva propuesta. Toca para revisar.' },
  },
  [NotificationType.NEGOTIATION_PROPOSAL_COUNTERED]: {
    en: { heading: 'Counteroffer received', body: 'Your proposal got a counteroffer. Tap to review.' },
    es: { heading: 'Contraoferta recibida', body: 'Tu propuesta recibió una contraoferta. Toca para revisar.' },
  },
  [NotificationType.NEGOTIATION_PROPOSAL_REJECTED]: {
    en: { heading: 'Proposal rejected', body: 'A proposal was rejected. Tap to see details.' },
    es: { heading: 'Propuesta rechazada', body: 'Una propuesta fue rechazada. Toca para ver detalles.' },
  },
  [NotificationType.NEGOTIATION_PROPOSAL_ACCEPTED]: {
    en: { heading: 'Proposal accepted', body: 'Your proposal was accepted. Tap to continue.' },
    es: { heading: 'Propuesta aceptada', body: 'Tu propuesta fue aceptada. Toca para continuar.' },
  },
  [NotificationType.MESSAGE_CREATED]: {
    en: { heading: 'New message', body: 'You have a new message. Tap to open the chat.' },
    es: { heading: 'Nuevo mensaje', body: 'Tienes un nuevo mensaje. Toca para abrir el chat.' },
  },
  [NotificationType.CALL_INVITED]: {
    en: { heading: 'Incoming call', body: 'Someone is calling you. Tap to answer.' },
    es: { heading: 'Llamada entrante', body: 'Alguien te está llamando. Toca para responder.' },
  },
};

/**
 * Per-type localized content catalog with `en`/`es` parity.
 *
 * `render(type, language, payloadRef)` returns OneSignal `headings`/`contents` for BOTH locales
 * (OneSignal picks per device); `language` is the recipient's preferred locale used only as the
 * fallback default. A startup parity check throws if any type is missing a locale — so a missing
 * translation fails fast rather than shipping a blank push.
 */
@Injectable()
export class NotificationContentCatalog implements OnModuleInit {
  /** Fail fast at startup if any type is missing a supported locale (P15). */
  onModuleInit(): void {
    this.assertParity();
  }

  /** Throw when any registered type is missing `en` or `es` heading/body. */
  assertParity(): void {
    const missing: string[] = [];
    for (const [type, templates] of Object.entries(CONTENT_TEMPLATES)) {
      for (const locale of CONTENT_LOCALES) {
        const template = templates[locale];
        if (!template || !template.heading.trim() || !template.body.trim()) {
          missing.push(`${type}:${locale}`);
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(`NotificationContentCatalog missing locale content: ${missing.join(', ')}`);
    }
  }

  /**
   * Render a type's content for all locales, interpolating `{placeholder}` tokens from
   * `payloadRef` (ids/labels only). Unknown placeholders are left intact rather than throwing.
   */
  render(type: NotificationType, payloadRef: Readonly<Record<string, string>>): RenderedContent {
    const templates = CONTENT_TEMPLATES[type];
    if (!templates) {
      throw new Error(`No content template registered for type: ${type}`);
    }

    const headings: Record<string, string> = {};
    const contents: Record<string, string> = {};
    for (const locale of CONTENT_LOCALES) {
      const template = templates[locale];
      headings[locale] = this.interpolate(template.heading, payloadRef);
      contents[locale] = this.interpolate(template.body, payloadRef);
    }
    return { headings, contents };
  }

  /** Replace `{key}` tokens with `payloadRef[key]`; unknown keys are left as-is. */
  private interpolate(template: string, payloadRef: Readonly<Record<string, string>>): string {
    return template.replace(/\{(\w+)\}/g, (match, key: string) => {
      const value = payloadRef[key];
      return value === undefined ? match : value;
    });
  }
}
