/**
 * Hex-guard test — runs the static color-literal scan in CI alongside the suite.
 *
 * The guard enforces REQ-TH1 / REQ-TH9: no raw hex / rgba color literal in application source
 * outside `primitives.ts` (with documented exemptions for the WCAG utility and Mapbox map-style
 * config). During the incremental migration, screens not yet tokenized still contain hex, so this
 * test asserts the guard *runs and reports* rather than failing the build; it fails only if a
 * *migrated* file (in the allow-list of completed migrations) regresses by reintroducing hex.
 *
 * When the migration is fully complete, flip `EXPECT_ZERO` to true (or delete the allow-list) to
 * turn this into a hard "only primitives.ts" gate.
 */

const { scanForHex } = require('../../../scripts/hex-guard.js') as {
  scanForHex: () => Array<{ file: string; line: number; text: string }>;
};

/** Files already migrated to tokens — these MUST stay hex-free (regression guard). */
const MIGRATED_FILES = [
  'src/navigation/RoleBasedNavigator.tsx',
  'src/navigation/HostNavigator.tsx',
  'src/navigation/CleanerNavigator.tsx',
  'src/screens/subscriptions/PaywallScreen.tsx',
  'src/screens/subscriptions/components/ProBadge.tsx',
  'src/screens/roles/RoleSelectionScreen.tsx',
  'src/screens/roles/RoleSwitchButton.tsx',
  'src/screens/roles/AddSecondRoleButton.tsx',
].map((p) => p.replace(/\//g, require('path').sep));

const EXPECT_ZERO = false;

describe('hex-guard (no raw hex outside primitives.ts)', () => {
  it('does not flag any color literal in already-migrated files', () => {
    const offenders = scanForHex();
    const migratedOffenders = offenders.filter((o) => MIGRATED_FILES.includes(o.file));
    expect(migratedOffenders).toEqual([]);
  });

  it('reports the outstanding (not-yet-migrated) files for visibility', () => {
    const offenders = scanForHex();
    const files = Array.from(new Set(offenders.map((o) => o.file))).sort();
    // Informational: surfaces how many files remain. Not a hard failure during migration.
    console.warn(`[hex-guard] ${files.length} file(s) still contain hex (pending migration).`);
    if (EXPECT_ZERO) {
      expect(files).toEqual([]);
    } else {
      expect(Array.isArray(files)).toBe(true);
    }
  });
});
