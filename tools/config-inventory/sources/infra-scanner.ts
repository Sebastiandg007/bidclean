/**
 * INFRA source scanner.
 *
 * Parses `docker-compose*.yml` files under `infra/`, resolving `${VAR}` and
 * `${VAR:-default}` shell interpolation to discover service-bootstrap variables.
 * Literal `environment:` values (no interpolation) are container-internal
 * defaults, not project configuration inputs, so only interpolated names are
 * emitted as INFRA variables.
 */

import { join } from 'node:path';
import type { DeclaredVariable } from '../inventory.model';
import { collectFiles, lineNumberAt, readSource, toRepoRelativePosix } from './scanner-utils';

const INFRA_DIR = 'infra';
const COMPOSE_FILE_PATTERN = /^docker-compose.*\.ya?ml$/;

/** Matches a `${VAR}` or `${VAR:-default}` shell interpolation. */
const INTERPOLATION_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g;

/**
 * Scan the INFRA source type (docker-compose interpolation variables).
 *
 * @param repoRoot - Absolute repo root.
 * @returns Declared variables discovered in compose interpolations.
 */
export function scanInfra(repoRoot: string): DeclaredVariable[] {
  const composeFiles = collectFiles(join(repoRoot, INFRA_DIR), (name) =>
    COMPOSE_FILE_PATTERN.test(name),
  );

  const declared: DeclaredVariable[] = [];
  for (const absolutePath of composeFiles) {
    const content = readSource(absolutePath);
    const relativePath = toRepoRelativePosix(repoRoot, absolutePath);

    for (const [name, line] of extractInterpolatedNames(content)) {
      declared.push({
        name,
        surface: 'INFRA',
        group: 'infra',
        consumedBy: [relativePath],
        requiredByValidator: false, // infra bootstrap, not a runtime validator
        provenance: {
          sourceType: 'INFRA',
          sourceFile: relativePath,
          sourceLocation: `L${line}`,
        },
      });
    }
  }
  return declared;
}

/** Extract distinct interpolated variable names and their first line numbers. */
function extractInterpolatedNames(content: string): Map<string, number> {
  const results = new Map<string, number>();
  let match: RegExpExecArray | null = INTERPOLATION_PATTERN.exec(content);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined && !results.has(name)) {
      results.set(name, lineNumberAt(content, match.index));
    }
    match = INTERPOLATION_PATTERN.exec(content);
  }
  return results;
}
