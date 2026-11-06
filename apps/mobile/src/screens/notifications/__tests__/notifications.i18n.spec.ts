/**
 * i18n parity test for the notifications namespace (Task 15.4).
 * Feature: push-notifications, Property 15 (localization parity) — client side.
 *
 * Asserts the en and es `notifications` bundles have an IDENTICAL set of leaf keys, so no UI string
 * is missing a translation in either language.
 */

import en from '../../../i18n/locales/en/notifications.json';
import es from '../../../i18n/locales/es/notifications.json';

/** Collect the dotted leaf-key paths of a nested object. */
function leafKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) {
    return [prefix];
  }
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe('notifications i18n parity', () => {
  it('Property 15 (client): en and es expose the identical key set', () => {
    const enKeys = leafKeys(en).sort();
    const esKeys = leafKeys(es).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it('has no empty string values in either language', () => {
    const values = (obj: unknown): string[] =>
      typeof obj === 'string'
        ? [obj]
        : Object.values(obj as Record<string, unknown>).flatMap(values);
    for (const value of [...values(en), ...values(es)]) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });
});
