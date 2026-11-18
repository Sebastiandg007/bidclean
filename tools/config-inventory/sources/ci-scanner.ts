/**
 * CI source scanner.
 *
 * Parses `.github/workflows/*.yml` `env:` blocks (workflow-, job-, service-, and
 * step-level) for variable names injected by the CI system. `codemagic.yaml` is
 * also parsed when present at the repo root; its absence (as in the current
 * tree) is handled gracefully without failing.
 */

import { join } from 'node:path';
import type { DeclaredVariable } from '../inventory.model';
import {
  collectFiles,
  isFile,
  readSource,
  toRepoRelativePosix,
} from './scanner-utils';

const WORKFLOWS_DIR = join('.github', 'workflows');
const CODEMAGIC_FILE = 'codemagic.yaml';
const YAML_FILE_PATTERN = /\.ya?ml$/;

/** Matches an `env:` mapping opener and captures its indentation. */
const ENV_BLOCK_OPENER = /^(\s*)env:\s*$/;
/** Matches a `KEY: value` line and captures indentation, key, and value. */
const YAML_KEY_VALUE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;

/**
 * Scan the CI source type (GitHub Actions + optional Codemagic).
 *
 * @param repoRoot - Absolute repo root.
 * @returns Declared variables from CI `env:` blocks (empty if none).
 */
export function scanCi(repoRoot: string): DeclaredVariable[] {
  const files: string[] = collectFiles(join(repoRoot, WORKFLOWS_DIR), (name) =>
    YAML_FILE_PATTERN.test(name),
  );

  const codemagicPath = join(repoRoot, CODEMAGIC_FILE);
  if (isFile(codemagicPath)) {
    files.push(codemagicPath);
  }

  const declared: DeclaredVariable[] = [];
  for (const absolutePath of files) {
    const content = readSource(absolutePath);
    const relativePath = toRepoRelativePosix(repoRoot, absolutePath);
    for (const { name, line } of extractCiEnvNames(content)) {
      declared.push({
        name,
        surface: 'INFRA',
        group: 'ci',
        consumedBy: [relativePath],
        requiredByValidator: false,
        provenance: {
          sourceType: 'CI',
          sourceFile: relativePath,
          sourceLocation: `L${line}`,
        },
      });
    }
  }
  return declared;
}

interface CiEnvName {
  name: string;
  line: number;
}

/**
 * Extract variable names declared inside `env:` mappings of a YAML workflow.
 * A block is delimited by indentation: keys more indented than the `env:` line
 * belong to it; the first line at or below that indent closes the block.
 */
function extractCiEnvNames(content: string): CiEnvName[] {
  const lines = content.split(/\r?\n/);
  const results: CiEnvName[] = [];
  const seen = new Set<string>();

  let envIndent: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      continue;
    }

    const opener = ENV_BLOCK_OPENER.exec(line);
    if (opener) {
      envIndent = (opener[1] ?? '').length;
      continue;
    }

    if (envIndent === null) {
      continue;
    }

    const keyValue = YAML_KEY_VALUE.exec(line);
    const indent = (keyValue?.[1] ?? '').length;
    const key = keyValue?.[2];

    if (keyValue && key !== undefined && indent > envIndent) {
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ name: key, line: index + 1 });
      }
      continue;
    }

    // A line at or below the env indent closes the current env block.
    envIndent = null;
  }
  return results;
}
