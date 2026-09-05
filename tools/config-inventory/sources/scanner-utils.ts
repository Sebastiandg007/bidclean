/**
 * Shared helpers for the per-source scanners: safe file reads, recursive file
 * discovery, and env-name extraction. Kept dependency-free so scanners stay
 * pure functions over the repo tree.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Raised when a scanner cannot read a source it was told to parse. */
export class ScannerReadError extends Error {
  constructor(
    public readonly file: string,
    public readonly reason: string,
  ) {
    super(`Cannot read config source '${file}': ${reason}`);
    this.name = 'ScannerReadError';
  }
}

/** Read a UTF-8 file, failing loudly (never silently skipping a source). */
export function readSource(absolutePath: string): string {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new ScannerReadError(absolutePath, (error as Error).message);
  }
}

/** Convert an absolute path to a repo-relative POSIX path for provenance. */
export function toRepoRelativePosix(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).split(sep).join('/');
}

/** Directory names that never contain first-party configuration sources. */
const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.venv',
  '.expo',
  '.ruff_cache',
  '.pytest_cache',
  '__pycache__',
]);

/**
 * Recursively collect files under a directory whose name matches `predicate`.
 * Ignored directories (deps, build output, VCS) are skipped entirely.
 *
 * @param rootDir - Absolute directory to walk.
 * @param predicate - Returns true for a file name that should be collected.
 * @returns Absolute paths of matching files (empty if the directory is absent).
 */
export function collectFiles(
  rootDir: string,
  predicate: (fileName: string) => boolean,
): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const collected: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const dirent of readdirSync(current, { withFileTypes: true })) {
      const childPath = join(current, dirent.name);
      if (dirent.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
          stack.push(childPath);
        }
        continue;
      }
      if (dirent.isFile() && predicate(dirent.name)) {
        collected.push(childPath);
      }
    }
  }

  return collected;
}

/** True when the path exists and is a regular file. */
export function isFile(absolutePath: string): boolean {
  return existsSync(absolutePath) && statSync(absolutePath).isFile();
}

/**
 * Extract every distinct `process.env.NAME` env-var name read in `content`,
 * paired with the 1-based line number of the first occurrence. Only the static
 * dot-access form is matched here; bracket/computed reads are the RUNTIME
 * scanner's responsibility.
 *
 * @param content - Source text to scan.
 * @returns Map of env-var name to first line number.
 */
export function extractProcessEnvDotReads(content: string): Map<string, number> {
  const pattern = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
  return collectNamedMatches(content, pattern);
}

/**
 * Extract distinct `EXPO_PUBLIC_*` names appearing anywhere in `content`
 * (covers both `process.env.EXPO_PUBLIC_X` and bracket/string forms).
 *
 * @param content - Source text to scan.
 * @returns Map of env-var name to first line number.
 */
export function extractExpoPublicNames(content: string): Map<string, number> {
  const pattern = /\b(EXPO_PUBLIC_[A-Za-z0-9_]+)\b/g;
  return collectNamedMatches(content, pattern);
}

/** Compute the 1-based line number of a character index within `content`. */
export function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content.charAt(i) === '\n') {
      line += 1;
    }
  }
  return line;
}

/**
 * Run a global regex whose first capture group is a variable name, returning a
 * map from each distinct name to the line of its first occurrence.
 */
function collectNamedMatches(content: string, pattern: RegExp): Map<string, number> {
  const results = new Map<string, number>();
  let match: RegExpExecArray | null = pattern.exec(content);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined && !results.has(name)) {
      results.set(name, lineNumberAt(content, match.index));
    }
    match = pattern.exec(content);
  }
  return results;
}
