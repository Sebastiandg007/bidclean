/**
 * DEPLOY source scanner.
 *
 * Covers values needed to deploy but not to run locally: deployment scripts,
 * VPS env manifests, and Traefik config. It scans an allowlist of known deploy
 * locations under `infra/` for `${VAR}` interpolation. When none of these exist
 * (as in the current tree — no Traefik, no deploy scripts), the scanner returns
 * no variables without failing.
 */

import { join } from 'node:path';
import type { DeclaredVariable } from '../inventory.model';
import { collectFiles, lineNumberAt, readSource, toRepoRelativePosix } from './scanner-utils';

/** Directories under the repo that hold deploy-time (not local-runtime) config. */
const DEPLOY_DIRS: readonly string[] = [join('infra', 'docker'), join('infra', 'traefik')];

/** File extensions treated as deploy manifests/scripts. */
const DEPLOY_FILE_PATTERN = /\.(ya?ml|toml|sh|env)$/;

/** Matches a `${VAR}` or `${VAR:-default}` shell interpolation. */
const INTERPOLATION_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g;

/**
 * Scan the DEPLOY source type (deploy scripts / VPS manifests / Traefik).
 *
 * @param repoRoot - Absolute repo root.
 * @returns Declared variables discovered in deploy sources (empty if none).
 */
export function scanDeploy(repoRoot: string): DeclaredVariable[] {
  const declared: DeclaredVariable[] = [];

  for (const deployDir of DEPLOY_DIRS) {
    const files = collectFiles(join(repoRoot, deployDir), (name) =>
      DEPLOY_FILE_PATTERN.test(name),
    );
    for (const absolutePath of files) {
      const content = readSource(absolutePath);
      const relativePath = toRepoRelativePosix(repoRoot, absolutePath);

      for (const [name, line] of extractInterpolatedNames(content)) {
        declared.push({
          name,
          surface: 'INFRA',
          group: 'deploy',
          consumedBy: [relativePath],
          requiredByValidator: false,
          provenance: {
            sourceType: 'DEPLOY',
            sourceFile: relativePath,
            sourceLocation: `L${line}`,
          },
        });
      }
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
