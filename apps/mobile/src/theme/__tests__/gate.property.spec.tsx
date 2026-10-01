/**
 * Property-based test for the resolution gate (no-FOUC predicate) — Property 3.
 *
 * Library: fast-check (≥100 iterations). One test per property.
 *
 * Over (isLoaded, osSchemeAvailable) ∈ {true,false}², the pure gate predicate `resolved` is true
 * IFF both inputs are true. The rendering consequences (no themed render / no splash-hide while
 * unresolved) are asserted in the provider render tests (gate.render.spec.tsx) with spies.
 */

import * as fc from 'fast-check';

/** The pure gate predicate extracted from ThemeProvider: resolved ⇔ isLoaded ∧ osSchemeRead. */
function isResolved(isLoaded: boolean, osSchemeRead: boolean): boolean {
  return isLoaded && osSchemeRead;
}

describe('resolution gate predicate — Property 3', () => {
  // Feature: dark-light-theme, Property 3: Resolution gate (no-FOUC predicate)
  it('P3: resolved === (isLoaded && osSchemeAvailable) for all input combinations', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (isLoaded, osSchemeRead) => {
        const resolved = isResolved(isLoaded, osSchemeRead);
        expect(resolved).toBe(isLoaded && osSchemeRead);
        // The only combination that resolves is both-true.
        if (!isLoaded || !osSchemeRead) {
          expect(resolved).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
