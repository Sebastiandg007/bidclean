/**
 * RUNTIME source scanner.
 *
 * Captures dynamic/indirect env reads NOT covered by the APPLICATION layer:
 *   - TypeScript computed reads `process.env[<expr>]` (bracket access), where
 *     the concrete names come from string literals passed nearby (e.g. the
 *     rate-limit guard's `envInt('RATE_LIMIT_...')` calls).
 *   - Python `os.environ[...]` / `os.getenv(...)` reads in AI application code.
 *
 * It scans API + AI source trees (excluding `*.constants.ts`, already covered by
 * APPLICATION, and test files) and only files that actually perform a bracket /
 * os.environ read, then harvests the string-literal env names in those files.
 */

import { join } from 'node:path';
import type { DeclaredVariable, Surface } from '../inventory.model';
import { collectFiles, lineNumberAt, readSource, toRepoRelativePosix } from './scanner-utils';

const API_SRC_DIR = join('services', 'api', 'src');
const AI_SRC_DIR = join('services', 'ai', 'src');

/** Indicates a file performs a dynamic `process.env[...]` bracket read. */
const HAS_BRACKET_ENV_READ = /process\.env\[/;
/** Indicates a file performs a Python `os.environ` / `os.getenv` read. */
const HAS_OS_ENVIRON_READ = /os\.(?:environ|getenv)\b/;

/** Matches an env-var-shaped string literal: 'NAME' or "NAME" (UPPER_SNAKE). */
const ENV_NAME_LITERAL = /['"]([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)['"]/g;

/**
 * Scan the RUNTIME source type (dynamic/indirect env reads).
 *
 * @param repoRoot - Absolute repo root.
 * @returns Declared variables from dynamic reads (empty if none).
 */
export function scanRuntime(repoRoot: string): DeclaredVariable[] {
  return [
    ...scanTree(repoRoot, join(repoRoot, API_SRC_DIR), 'API', HAS_BRACKET_ENV_READ),
    ...scanTree(repoRoot, join(repoRoot, AI_SRC_DIR), 'AI', HAS_OS_ENVIRON_READ),
  ];
}

/** Scan one source tree for files with dynamic reads and harvest literal names. */
function scanTree(
  repoRoot: string,
  treeDir: string,
  surface: Surface,
  dynamicReadPattern: RegExp,
): DeclaredVariable[] {
  const files = collectFiles(treeDir, isScannableRuntimeFile);
  const declared: DeclaredVariable[] = [];

  for (const absolutePath of files) {
    const content = readSource(absolutePath);
    if (!dynamicReadPattern.test(content)) {
      continue;
    }
    const relativePath = toRepoRelativePosix(repoRoot, absolutePath);
    for (const [name, line] of extractEnvNameLiterals(content)) {
      declared.push({
        name,
        surface,
        group: 'runtime',
        consumedBy: [relativePath],
        requiredByValidator: false,
        provenance: {
          sourceType: 'RUNTIME',
          sourceFile: relativePath,
          sourceLocation: `L${line}`,
        },
      });
    }
  }
  return declared;
}

/** A runtime-scannable source file (skips constants files and test files). */
function isScannableRuntimeFile(fileName: string): boolean {
  if (fileName.endsWith('.constants.ts')) {
    return false;
  }
  if (fileName.endsWith('.spec.ts') || fileName.endsWith('.test.ts')) {
    return false;
  }
  if (fileName.startsWith('test_') || fileName.endsWith('_test.py')) {
    return false;
  }
  return fileName.endsWith('.ts') || fileName.endsWith('.py');
}

/** Extract distinct UPPER_SNAKE string-literal env names + first line numbers. */
function extractEnvNameLiterals(content: string): Map<string, number> {
  const results = new Map<string, number>();
  let match: RegExpExecArray | null = ENV_NAME_LITERAL.exec(content);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined && name !== 'NODE_ENV' && !results.has(name)) {
      results.set(name, lineNumberAt(content, match.index));
    }
    match = ENV_NAME_LITERAL.exec(content);
  }
  return results;
}
