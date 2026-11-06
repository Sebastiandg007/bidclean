/**
 * Property-based tests for the exposure scanner + compliance (Properties 11-12).
 * Uses a temp fixture repo with a MOCKED GitRunner so no real credential is ever
 * involved, and asserts the "never mutates" invariant (file bytes unchanged).
 * Uses fast-check, minimum 100 runs per property.
 */

import fc from 'fast-check';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { scanExposure, type GitRunner, RUNTIME_ENV_FILES } from '../exposure-scanner';
import { buildInventoryReport } from '../report';
import type { Finding } from '../inventory.model';

const RUNS = { numRuns: 150 };

/** A GitRunner that treats every runtime env file as ignored and lists given files. */
function mockGit(trackedFiles: string[]): GitRunner {
  return {
    isIgnored: (): boolean => true, // env files ignored → not a hygiene finding
    listTrackedFiles: (): string[] => trackedFiles,
  };
}

/** Create a temp repo, write files, run the body, then remove the repo. */
function withTempRepo(files: Record<string, string>, body: (repoRoot: string) => void): void {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ci-exposure-'));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const absolute = join(repoRoot, relative);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content, 'utf8');
    }
    body(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

/** A line containing a known secret pattern (Stripe live key shape). */
const secretLineArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z0-9]{24,40}$/)
  .map((body) => `stripe_key = sk_live_${body}`);

describe('exposure-scanner — property-based', () => {
  // Feature: secrets-inventory, Property 11: For any set of tracked files, if any file is a runtime
  // env file or contains a known secret pattern (excluding .env.example placeholders), the scanner
  // produces a blocking SECRET_EXPOSURE finding and compliant is false; and the scan never mutates,
  // moves, or rotates the file. A clean run asserts only that no known pattern was detected.
  it('Property 11: exposure scan flags any known-pattern secret and never mutates', () => {
    fc.assert(
      fc.property(secretLineArb, fc.constantFrom('config.ts', 'src/app.json'), (line, fileName) => {
        withTempRepo({ [fileName]: `${line}\n` }, (repoRoot) => {
          const absolute = join(repoRoot, fileName);
          const before = readFileSync(absolute);

          const result = scanExposure(repoRoot, mockGit([fileName]));

          // Blocking SECRET_EXPOSURE finding produced.
          expect(result.secretPatternHits.length).toBeGreaterThanOrEqual(1);
          expect(result.findings.some((f) => f.code === 'SECRET_EXPOSURE' && f.blocking)).toBe(true);
          expect(result.noKnownExposureDetected).toBe(false);
          // The finding never contains the secret value.
          for (const f of result.findings) {
            expect(f.detail.includes(line)).toBe(false);
          }

          // Never mutates: file bytes are identical before and after.
          const after = readFileSync(absolute);
          expect(after.equals(before)).toBe(true);
        });
      }),
      RUNS,
    );
  });

  it('Property 11 (clean case): a placeholder-only .env.example is not flagged', () => {
    fc.assert(
      fc.property(fc.constantFrom('sk_test_...', 'CHANGE_ME', 'pk.ey...'), (placeholder) => {
        withTempRepo({ '.env.example': `STRIPE_SECRET_KEY=${placeholder}\n` }, (repoRoot) => {
          const result = scanExposure(repoRoot, mockGit(['.env.example']));
          expect(result.secretPatternHits.length).toBe(0);
          expect(result.noKnownExposureDetected).toBe(true);
        });
      }),
      RUNS,
    );
  });

  // Feature: secrets-inventory, Property 12: For any inventory report, compliant is true iff the
  // report contains no blocking finding (SECRET_EXPOSURE, SECRET_ON_CLIENT).
  it('Property 12: compliance requires zero blocking findings', () => {
    const findingArb: fc.Arbitrary<Finding> = fc.record({
      code: fc.constantFrom(
        'MISSING_IN_ENV_EXAMPLE',
        'ORPHANED_ENV_EXAMPLE',
        'REQUIRED_MISMATCH',
        'SECRET_ON_CLIENT',
        'SECRET_EXPOSURE',
      ),
      variable: fc.option(fc.string(), { nil: undefined }),
      detail: fc.string(),
      blocking: fc.boolean(),
    });

    fc.assert(
      fc.property(fc.array(findingArb, { maxLength: 20 }), (findings) => {
        const report = buildInventoryReport([], findings);
        const hasBlocking = findings.some((f) => f.blocking);
        expect(report.compliant).toBe(!hasBlocking);
      }),
      RUNS,
    );
  });

  it('exposes the runtime env file list it checks', () => {
    expect(RUNTIME_ENV_FILES).toContain('.env');
  });
});
