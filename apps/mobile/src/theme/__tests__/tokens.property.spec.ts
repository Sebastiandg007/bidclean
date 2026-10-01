/**
 * Property-based tests for the token layer — Properties P1, P2, P6.
 *
 * Library: fast-check (≥100 iterations each). One test per property.
 */

import * as fc from 'fast-check';

import { THEMES, assertTokenParity } from '../themes';
import { darkTheme } from '../dark.theme';
import { lightTheme } from '../light.theme';
import { resolve } from '../resolveTheme';
import { contrastRatio, WCAG_AA_NORMAL, WCAG_AA_LARGE } from '../contrast';
import { ResolvedTheme, ThemeMode, type SemanticTokens } from '../tokens';

const SEMANTIC_KEYS: Array<keyof SemanticTokens> = [
  'background',
  'surface',
  'surfaceElevated',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'accent',
  'onAccent',
  'border',
  'divider',
  'danger',
  'success',
  'warning',
  'overlay',
  'shadow',
];

const RESOLVED_THEMES: ResolvedTheme[] = [ResolvedTheme.DARK, ResolvedTheme.LIGHT];
const MODES: ThemeMode[] = [ThemeMode.DARK, ThemeMode.LIGHT, ThemeMode.SYSTEM];
const OS_SCHEMES: Array<'dark' | 'light' | null> = ['dark', 'light', null];

describe('theme token layer — properties', () => {
  // Feature: dark-light-theme, Property 1: Token-shape parity across both themes
  it('P1: every semantic token is defined and non-empty in both themes (identical shape)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SEMANTIC_KEYS),
        fc.constantFrom(...RESOLVED_THEMES),
        (key, themeName) => {
          const value = THEMES[themeName][key];
          expect(typeof value).toBe('string');
          expect(value.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );

    // Structural parity: dark and light expose the identical key set (no dark-only/light-only).
    const darkKeys = Object.keys(darkTheme).sort();
    const lightKeys = Object.keys(lightTheme).sort();
    const shapeKeys = [...SEMANTIC_KEYS].sort();
    expect(darkKeys).toEqual(lightKeys);
    expect(darkKeys).toEqual(shapeKeys);
    expect(() => assertTokenParity()).not.toThrow();
  });

  // Feature: dark-light-theme, Property 2: Deterministic mode resolution and mode/resolvedTheme distinctness
  it('P2: resolve(mode, osScheme) matches the rule table and never returns SYSTEM', () => {
    fc.assert(
      fc.property(fc.constantFrom(...MODES), fc.constantFrom(...OS_SCHEMES), (mode, scheme) => {
        const resolved = resolve(mode, scheme);

        // Result is always a renderable theme, never SYSTEM.
        expect(RESOLVED_THEMES).toContain(resolved);

        if (mode === ThemeMode.DARK) {
          expect(resolved).toBe(ResolvedTheme.DARK);
        } else if (mode === ThemeMode.LIGHT) {
          expect(resolved).toBe(ResolvedTheme.LIGHT);
        } else if (scheme === 'light') {
          expect(resolved).toBe(ResolvedTheme.LIGHT);
        } else {
          // SYSTEM + 'dark' or null → DARK (brand default)
          expect(resolved).toBe(ResolvedTheme.DARK);
        }

        // The resolved token set is exactly THEMES[resolve(...)].
        expect(THEMES[resolved]).toBe(THEMES[resolve(mode, scheme)]);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: dark-light-theme, Property 6: WCAG 2.1 AA contrast for token pairs in both themes
  it('P6: text/essential-UI token pairs meet WCAG 2.1 AA in both themes', () => {
    // [foreground, background, minRatio] pairs. Normal text ≥ 4.5; large/essential UI ≥ 3.0.
    const pairs: Array<[keyof SemanticTokens, keyof SemanticTokens, number]> = [
      ['textPrimary', 'background', WCAG_AA_NORMAL],
      ['textPrimary', 'surface', WCAG_AA_NORMAL],
      ['textSecondary', 'surface', WCAG_AA_NORMAL],
      ['textSecondary', 'background', WCAG_AA_NORMAL],
      ['textMuted', 'surface', WCAG_AA_LARGE],
      ['onAccent', 'accent', WCAG_AA_NORMAL],
      ['danger', 'background', WCAG_AA_LARGE],
      ['success', 'background', WCAG_AA_LARGE],
      ['warning', 'background', WCAG_AA_LARGE],
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...pairs),
        fc.constantFrom(...RESOLVED_THEMES),
        ([fg, bg, min], themeName) => {
          const theme = THEMES[themeName];
          const ratio = contrastRatio(theme[fg], theme[bg]);
          expect(ratio).toBeGreaterThanOrEqual(min);
        },
      ),
      { numRuns: 100 },
    );
  });
});
