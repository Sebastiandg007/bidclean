/**
 * Secret-exposure & hygiene scanner.
 *
 * Real verification, not "the .gitignore mentions .env". It:
 *   - runs `git check-ignore` on the runtime env files,
 *   - runs a tracked-file scan (`git ls-files`) — a file in .gitignore can still
 *     already be tracked,
 *   - runs a secret-pattern scan over tracked files (generic + provider-specific
 *     detectors), SKIPPING `.env.example` placeholders by design.
 *
 * FRAMING: the detectors detect KNOWN secret shapes. A clean run means only
 * "no known secret-pattern exposure detected" — never proof that no secret
 * exists. It NEVER mutates, moves, or rotates any file, and findings reference
 * the file, line, and matched provider/pattern — never the captured value.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from './inventory.model';

/** Runtime env files whose ignore status is asserted. */
export const RUNTIME_ENV_FILES: readonly string[] = [
  '.env',
  '.env.local',
  '.env.staging',
  '.env.production',
];

/** The one env file that is expected to be tracked (placeholders only). */
const ALLOWED_TRACKED_ENV_FILE = '.env.example';

/** A single provider-specific or generic secret detector. */
export interface SecretDetector {
  readonly provider: string;
  readonly pattern: RegExp;
}

/**
 * Detectors combine generic patterns with provider-specific ones. They assert
 * detection of KNOWN shapes; they are not a proof of absence.
 *
 * Patterns are anchored to the token shapes real credentials use (provider
 * prefixes, PEM headers) and are deliberately specific so `.env.example`
 * placeholders (`sk_test_...`, `sk_...`, `ca-app-pub-...`) and generated
 * integrity hashes are not matched. Live Stripe/RevenueCat keys carry a long
 * high-entropy body after the prefix that placeholders (ending in `...`) lack.
 */
export const SECRET_DETECTORS: readonly SecretDetector[] = [
  { provider: 'Stripe', pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b/ },
  { provider: 'Stripe', pattern: /\b(?:sk|rk)_test_[A-Za-z0-9]{24,}\b/ },
  { provider: 'Stripe', pattern: /\bwhsec_[A-Za-z0-9]{24,}\b/ },
  { provider: 'AWS', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { provider: 'AWS', pattern: /aws_secret_access_key["']?\s*[=:]\s*["']?[A-Za-z0-9/+]{40}\b/i },
  // RevenueCat REST secret keys: `sk_` followed by a long high-entropy body.
  { provider: 'RevenueCat', pattern: /\bsk_[A-Za-z0-9]{24,}\b/ },
  { provider: 'Generic', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
];

/** A single secret-pattern hit (value is never captured into the finding). */
export interface SecretPatternHit {
  file: string;
  provider: string;
  pattern: string;
  line: number;
}

/** Result of the exposure & hygiene scan. */
export interface ExposureResult {
  checkIgnore: Array<{ file: string; ignored: boolean }>;
  trackedEnvFiles: string[];
  secretPatternHits: SecretPatternHit[];
  /** true only means: no KNOWN pattern matched — NOT proof of absence. */
  noKnownExposureDetected: boolean;
  findings: Finding[];
}

/** Abstraction over the git commands the scanner needs (injectable for tests). */
export interface GitRunner {
  /** Return true when `git check-ignore <file>` reports the file as ignored. */
  isIgnored(repoRoot: string, file: string): boolean;
  /** Return the repo-relative POSIX paths of all tracked files. */
  listTrackedFiles(repoRoot: string): string[];
}

/** Raised when git is unavailable, so hygiene cannot be asserted (not a pass). */
export class GitUnavailableError extends Error {
  constructor(reason: string) {
    super(`git is unavailable, cannot assert hygiene: ${reason}`);
    this.name = 'GitUnavailableError';
  }
}

/** Default git runner shelling out to the real `git` binary. */
export const defaultGitRunner: GitRunner = {
  isIgnored(repoRoot: string, file: string): boolean {
    try {
      execFileSync('git', ['check-ignore', '--quiet', file], { cwd: repoRoot });
      return true; // exit 0 => ignored
    } catch (error) {
      if (isExitCode(error, 1)) {
        return false; // exit 1 => not ignored
      }
      throw new GitUnavailableError((error as Error).message);
    }
  },
  listTrackedFiles(repoRoot: string): string[] {
    try {
      const output = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' });
      return output.split(/\r?\n/).filter((line) => line.trim().length > 0);
    } catch (error) {
      throw new GitUnavailableError((error as Error).message);
    }
  },
};

/**
 * Scan the repo for secret exposure and env-file hygiene.
 *
 * @param repoRoot - Absolute repo root.
 * @param git - Git runner (defaults to the real git binary; injectable for tests).
 * @returns The exposure result, including blocking findings for any hit.
 */
export function scanExposure(repoRoot: string, git: GitRunner = defaultGitRunner): ExposureResult {
  const checkIgnore = RUNTIME_ENV_FILES.map((file) => ({
    file,
    ignored: git.isIgnored(repoRoot, file),
  }));

  const trackedFiles = git.listTrackedFiles(repoRoot);
  const trackedEnvFiles = findTrackedEnvFiles(trackedFiles);
  const secretPatternHits = scanTrackedFilesForSecrets(repoRoot, trackedFiles);

  const findings = buildExposureFindings(checkIgnore, trackedEnvFiles, secretPatternHits);
  const noKnownExposureDetected =
    trackedEnvFiles.length === 0 && secretPatternHits.length === 0 && !hasUnignoredEnvFile(checkIgnore);

  return {
    checkIgnore,
    trackedEnvFiles,
    secretPatternHits,
    noKnownExposureDetected,
    findings,
  };
}

/** Tracked env files other than the allowed `.env.example`. */
function findTrackedEnvFiles(trackedFiles: readonly string[]): string[] {
  return trackedFiles.filter((file) => {
    const base = file.split('/').pop() ?? file;
    if (base === ALLOWED_TRACKED_ENV_FILE) {
      return false;
    }
    return base === '.env' || base.startsWith('.env.');
  });
}

/**
 * Scan every tracked file for known secret patterns, skipping `.env.example`
 * (its placeholders are the expected safe shape). Reads files read-only.
 */
function scanTrackedFilesForSecrets(
  repoRoot: string,
  trackedFiles: readonly string[],
): SecretPatternHit[] {
  const hits: SecretPatternHit[] = [];
  for (const relativeFile of trackedFiles) {
    const base = relativeFile.split('/').pop() ?? relativeFile;
    if (base === ALLOWED_TRACKED_ENV_FILE) {
      continue;
    }
    const absolutePath = join(repoRoot, relativeFile);
    if (!existsSync(absolutePath)) {
      continue;
    }
    hits.push(...scanFileContentForSecrets(relativeFile, readFileSafely(absolutePath)));
  }
  return hits;
}

/** Read a file as UTF-8, returning empty string on binary/unreadable content. */
function readFileSafely(absolutePath: string): string {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch {
    return '';
  }
}

/** Scan a single file's content for every detector; record line + provider. */
export function scanFileContentForSecrets(file: string, content: string): SecretPatternHit[] {
  const hits: SecretPatternHit[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index] ?? '';
    for (const detector of SECRET_DETECTORS) {
      if (detector.pattern.test(lineText)) {
        hits.push({
          file,
          provider: detector.provider,
          pattern: detector.pattern.source,
          line: index + 1,
        });
      }
    }
  }
  return hits;
}

/** Build the exposure findings from the three checks (all blocking). */
function buildExposureFindings(
  checkIgnore: ReadonlyArray<{ file: string; ignored: boolean }>,
  trackedEnvFiles: readonly string[],
  secretPatternHits: readonly SecretPatternHit[],
): Finding[] {
  const findings: Finding[] = [];

  for (const entry of checkIgnore) {
    if (!entry.ignored) {
      findings.push({
        code: 'SECRET_EXPOSURE',
        variable: entry.file,
        detail: `runtime env file '${entry.file}' is NOT git-ignored`,
        blocking: true,
      });
    }
  }

  for (const file of trackedEnvFiles) {
    findings.push({
      code: 'SECRET_EXPOSURE',
      variable: file,
      detail: `runtime env file '${file}' is tracked by git`,
      blocking: true,
    });
  }

  for (const hit of secretPatternHits) {
    findings.push({
      code: 'SECRET_EXPOSURE',
      variable: hit.file,
      detail: `${hit.provider} secret pattern detected in '${hit.file}' at L${hit.line} (value not shown)`,
      blocking: true,
    });
  }

  return findings;
}

/** True when any runtime env file was reported as not ignored. */
function hasUnignoredEnvFile(
  checkIgnore: ReadonlyArray<{ file: string; ignored: boolean }>,
): boolean {
  return checkIgnore.some((entry) => !entry.ignored);
}

/** True when an execFileSync error carries a specific process exit code. */
function isExitCode(error: unknown, code: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === code
  );
}
