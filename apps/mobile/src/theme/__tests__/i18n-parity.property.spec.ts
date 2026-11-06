/**
 * Property-based test for i18n en/es parity of theming labels — Property 7.
 *
 * Library: fast-check (≥100 iterations). One test per property.
 *
 * Every appearance/theming key exists and resolves to a non-empty string in BOTH en and es; the two
 * locales expose an identical theming-key set.
 */

import * as fc from 'fast-check';

import en from '../../i18n/locales/en/appearance.json';
import es from '../../i18n/locales/es/appearance.json';

/** Flatten a nested translation object into dotted keys → string values. */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      Object.assign(out, flatten(value as Record<string, unknown>, path));
    } else {
      out[path] = String(value);
    }
  }
  return out;
}

const enFlat = flatten(en as Record<string, unknown>);
const esFlat = flatten(es as Record<string, unknown>);
const allKeys = Array.from(new Set([...Object.keys(enFlat), ...Object.keys(esFlat)]));

describe('appearance i18n parity — Property 7', () => {
  // Feature: dark-light-theme, Property 7: i18n en/es parity for theming labels
  it('P7: every theming key exists and is non-empty in both en and es', () => {
    // Sanity: the two locales expose the identical key set.
    expect(Object.keys(enFlat).sort()).toEqual(Object.keys(esFlat).sort());

    fc.assert(
      fc.property(fc.constantFrom(...allKeys), (key) => {
        const enValue = enFlat[key];
        const esValue = esFlat[key];
        expect(typeof enValue).toBe('string');
        expect(typeof esValue).toBe('string');
        expect((enValue ?? '').trim().length).toBeGreaterThan(0);
        expect((esValue ?? '').trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('P7: the required Dark/Light/System mode labels are present in both locales', () => {
    for (const key of ['mode.dark', 'mode.light', 'mode.system']) {
      expect((enFlat[key] ?? '').length).toBeGreaterThan(0);
      expect((esFlat[key] ?? '').length).toBeGreaterThan(0);
    }
  });
});
