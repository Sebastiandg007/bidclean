/**
 * BUILD source scanner.
 *
 * Covers values needed to build a client artifact: `apps/mobile/eas.json` build
 * profiles and their `env` blocks / build-time tokens. If `eas.json` is absent
 * (as in the current tree), the scanner returns no variables without failing —
 * absence of a build config is not an error.
 */

import { join } from 'node:path';
import type { DeclaredVariable } from '../inventory.model';
import { isFile, readSource, toRepoRelativePosix } from './scanner-utils';

const EAS_JSON = join('apps', 'mobile', 'eas.json');

/**
 * Scan the BUILD source type (Expo EAS build profiles).
 *
 * @param repoRoot - Absolute repo root.
 * @returns Declared variables from build profile `env` blocks (empty if none).
 */
export function scanBuild(repoRoot: string): DeclaredVariable[] {
  const easPath = join(repoRoot, EAS_JSON);
  if (!isFile(easPath)) {
    return [];
  }

  const relativePath = toRepoRelativePosix(repoRoot, easPath);
  const parsed = parseEasJson(readSource(easPath), relativePath);
  const declared: DeclaredVariable[] = [];

  for (const { profile, name } of parsed) {
    declared.push({
      name,
      surface: 'MOBILE',
      group: 'build',
      consumedBy: [`${relativePath}#${profile}`],
      requiredByValidator: false,
      provenance: {
        sourceType: 'BUILD',
        sourceFile: relativePath,
        sourceLocation: `build.${profile}.env`,
      },
    });
  }
  return declared;
}

interface EasEnvVar {
  profile: string;
  name: string;
}

/** Parse EAS build-profile `env` keys from an `eas.json` document. */
function parseEasJson(content: string, relativePath: string): EasEnvVar[] {
  let document: unknown;
  try {
    document = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in ${relativePath}: ${(error as Error).message}`, {
      cause: error,
    });
  }

  const build = readObjectProperty(document, 'build');
  if (build === undefined) {
    return [];
  }

  const results: EasEnvVar[] = [];
  for (const profile of Object.keys(build)) {
    const profileConfig = readObjectProperty(build, profile);
    const env = profileConfig === undefined ? undefined : readObjectProperty(profileConfig, 'env');
    if (env === undefined) {
      continue;
    }
    for (const name of Object.keys(env)) {
      results.push({ profile, name });
    }
  }
  return results;
}

/** Safely read a nested object property, returning undefined when absent. */
function readObjectProperty(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const nested = (value as Record<string, unknown>)[key];
  if (typeof nested !== 'object' || nested === null) {
    return undefined;
  }
  return nested as Record<string, unknown>;
}
