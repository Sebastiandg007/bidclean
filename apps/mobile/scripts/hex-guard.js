/* eslint-disable */
/**
 * hex-guard.js — fails if any raw hex / rgba color literal appears in application source outside
 * `src/theme/primitives.ts` (the single physical home for raw color).
 *
 * Scope & exemptions (per the dark-light-theme spec, REQ-TH1 / REQ-TH9):
 *   - Scans `src/**` `.ts`/`.tsx`, EXCLUDING `__tests__`, `__mocks__`, and `src/theme/primitives.ts`.
 *   - EXEMPT (documented): map-rendering config that is data/asset-like, not app UI color values —
 *     `radar/components/map/mapStyles.ts`, `radar/radar.constants.ts`,
 *     `radar/components/map/CleanerMarker.tsx`, `properties/components/PropertyMap.tsx`. These
 *     configure Mapbox layer paint (a third-party map style), analogous to external assets.
 *   - The `EXEMPT` list is explicit so the guard is honest about what is intentionally excluded.
 *
 * Usage:
 *   node scripts/hex-guard.js            # prints offenders, exits 1 if any (0 otherwise)
 *   node scripts/hex-guard.js --json     # machine-readable summary
 *
 * The Jest test `src/theme/__tests__/hex-guard.spec.ts` invokes `scanForHex()` so the guard runs in
 * CI with the rest of the suite.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const PRIMITIVES = path.join('src', 'theme', 'primitives.ts');

// Documented, intentional exemptions.
const EXEMPT = [
  // The single physical home for raw color.
  path.join('src', 'theme', 'primitives.ts'),
  // Pure WCAG utility: parses `rgba(...)` strings — the token `rgba(` appears in parsing logic and
  // docstrings, but it defines NO color literal. Theme infrastructure, not a color value.
  path.join('src', 'theme', 'contrast.ts'),
  // Map-rendering config (Mapbox layer paint) — data/asset-like, analogous to external assets.
  path.join('src', 'screens', 'radar', 'components', 'map', 'mapStyles.ts'),
  path.join('src', 'screens', 'radar', 'radar.constants.ts'),
  path.join('src', 'screens', 'radar', 'components', 'map', 'CleanerMarker.tsx'),
  path.join('src', 'screens', 'properties', 'components', 'PropertyMap.tsx'),
];

// #RGB, #RRGGBB, #RRGGBBAA, and rgb()/rgba() literals.
const HEX_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function isExempt(relPath) {
  return EXEMPT.some((e) => relPath === e);
}

function scanForHex() {
  const files = walk(SRC_DIR, []);
  const offenders = [];

  for (const file of files) {
    const rel = path.relative(path.join(__dirname, '..'), file);
    if (isExempt(rel)) continue;

    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (HEX_RE.test(line)) {
        offenders.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
      }
    });
  }
  return offenders;
}

module.exports = { scanForHex, EXEMPT, PRIMITIVES };

if (require.main === module) {
  const offenders = scanForHex();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ count: offenders.length, offenders }, null, 2));
  } else if (offenders.length === 0) {
    console.log('hex-guard: OK — no raw hex outside primitives.ts (exemptions applied).');
  } else {
    console.error(`hex-guard: FAIL — ${offenders.length} hex literal(s) outside primitives.ts:`);
    for (const o of offenders) console.error(`  ${o.file}:${o.line}  ${o.text}`);
  }
  process.exit(offenders.length === 0 ? 0 : 1);
}
