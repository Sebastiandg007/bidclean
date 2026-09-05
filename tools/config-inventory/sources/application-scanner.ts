/**
 * APPLICATION source scanner.
 *
 * Covers values an application surface reads through its normal config layer:
 *   - NestJS API `*.constants.ts` files: `process.env.NAME ?? default` reads,
 *     and the env names each `validateXxxConfig()` asserts as required (a name
 *     mentioned in a message pushed onto the `errors` array).
 *   - FastAPI AI pydantic `BaseSettings` subclasses (fields → UPPER_SNAKE env).
 *   - Expo mobile `app.config.ts` (if present) and every `EXPO_PUBLIC_*` usage.
 *
 * Env NAME is keyed off the `process.env.<TOKEN>` read, never the exported const
 * identifier (they diverge, e.g. `OFFER_HOST_FEE_RATE_BPS` reads
 * `process.env.OFFER_HOST_FEE_RATE`).
 */

import { join } from 'node:path';
import type { DeclaredVariable, Surface } from '../inventory.model';
import {
  collectFiles,
  extractExpoPublicNames,
  extractProcessEnvDotReads,
  isFile,
  readSource,
  toRepoRelativePosix,
} from './scanner-utils';

const API_SRC_DIR = join('services', 'api', 'src');
const AI_SRC_DIR = join('services', 'ai', 'src');
const MOBILE_SRC_DIR = join('apps', 'mobile', 'src');
const MOBILE_APP_CONFIG = join('apps', 'mobile', 'app.config.ts');

const CONSTANTS_SUFFIX = '.constants.ts';
const PYTHON_SUFFIX = '.py';
const VALIDATOR_PATTERN = /export\s+function\s+(validate[A-Za-z0-9_]*Config)\s*\(/g;

/**
 * Scan the APPLICATION source type across API, AI, and MOBILE surfaces.
 *
 * @param repoRoot - Absolute repo root.
 * @returns Declared variables discovered on the application surfaces.
 */
export function scanApplication(repoRoot: string): DeclaredVariable[] {
  return [
    ...scanApiConstants(repoRoot),
    ...scanAiPydanticSettings(repoRoot),
    ...scanMobileExpoPublic(repoRoot),
  ];
}

/** Scan every `*.constants.ts` file under the API for env reads + validators. */
function scanApiConstants(repoRoot: string): DeclaredVariable[] {
  const files = collectFiles(join(repoRoot, API_SRC_DIR), (name) =>
    name.endsWith(CONSTANTS_SUFFIX),
  );

  const declared: DeclaredVariable[] = [];
  for (const absolutePath of files) {
    const content = readSource(absolutePath);
    const relativePath = toRepoRelativePosix(repoRoot, absolutePath);
    const group = deriveGroupFromConstantsPath(relativePath);
    const requiredNames = extractValidatorRequiredNames(content);

    for (const [name, line] of extractProcessEnvDotReads(content)) {
      if (name === 'NODE_ENV') {
        continue; // process-level, not a project configuration input
      }
      declared.push({
        name,
        surface: 'API',
        group,
        consumedBy: [relativePath],
        requiredByValidator: requiredNames.has(name),
        provenance: {
          sourceType: 'APPLICATION',
          sourceFile: relativePath,
          sourceLocation: `L${line}`,
        },
      });
    }
  }
  return declared;
}

/**
 * Extract the env-var names asserted required by any `validateXxxConfig()` in
 * `content`. Required detection follows the uniform validator pattern: an env
 * name that appears inside the function body (in a pushed error message or a
 * `[name, value]` tuple) is treated as validator-required.
 */
export function extractValidatorRequiredNames(content: string): Set<string> {
  const required = new Set<string>();
  let validatorMatch: RegExpExecArray | null = VALIDATOR_PATTERN.exec(content);
  while (validatorMatch !== null) {
    const bodyStart = validatorMatch.index + validatorMatch[0].length;
    const body = extractBalancedBody(content, bodyStart);
    for (const name of extractEnvNamesFromValidatorBody(body)) {
      required.add(name);
    }
    validatorMatch = VALIDATOR_PATTERN.exec(content);
  }
  return required;
}

/**
 * Extract UPPER_SNAKE env-var names referenced within a validator body. The
 * validators name each required variable literally (as a string in the pushed
 * message or a tuple label), so a screaming-snake token identifies it.
 */
function extractEnvNamesFromValidatorBody(body: string): Set<string> {
  const names = new Set<string>();
  const tokenPattern = /\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/g;
  let match: RegExpExecArray | null = tokenPattern.exec(body);
  while (match !== null) {
    const token = match[1];
    if (token !== undefined && token !== 'NODE_ENV') {
      names.add(token);
    }
    match = tokenPattern.exec(body);
  }
  return names;
}

/**
 * Return the substring of `content` that forms a brace-balanced block starting
 * at the first `{` at or after `fromIndex`. Used to isolate a function body.
 */
function extractBalancedBody(content: string, fromIndex: number): string {
  const open = content.indexOf('{', fromIndex);
  if (open === -1) {
    return '';
  }
  let depth = 0;
  for (let i = open; i < content.length; i += 1) {
    const char = content.charAt(i);
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(open + 1, i);
      }
    }
  }
  return content.slice(open + 1);
}

/** Derive a module group name from a `.../<module>/....constants.ts` path. */
function deriveGroupFromConstantsPath(relativePath: string): string {
  const segments = relativePath.split('/');
  const srcIndex = segments.indexOf('src');
  const moduleSegment = srcIndex >= 0 ? segments[srcIndex + 1] : undefined;
  return moduleSegment ?? 'api';
}

/** Field pattern in a pydantic `BaseSettings` subclass: `name: type = default`. */
const PYDANTIC_FIELD_PATTERN =
  /^\s{4}([a-z][a-z0-9_]*)\s*:\s*[A-Za-z0-9_[\], ]+?\s*=\s*(.+?)\s*$/;
const PYDANTIC_BASESETTINGS_PATTERN = /class\s+[A-Za-z0-9_]+\s*\(\s*BaseSettings\s*\)\s*:/;

/**
 * Scan FastAPI pydantic `BaseSettings` subclasses. Each field maps to an
 * UPPER_SNAKE env var; a field with a default is optional (pydantic loads it
 * without failing), consistent with the AI service's KYCSettings.
 */
function scanAiPydanticSettings(repoRoot: string): DeclaredVariable[] {
  const files = collectFiles(join(repoRoot, AI_SRC_DIR), (name) =>
    name.endsWith(PYTHON_SUFFIX),
  );

  const declared: DeclaredVariable[] = [];
  for (const absolutePath of files) {
    const content = readSource(absolutePath);
    if (!PYDANTIC_BASESETTINGS_PATTERN.test(content)) {
      continue;
    }
    const relativePath = toRepoRelativePosix(repoRoot, absolutePath);
    const lines = content.split(/\r?\n/);
    let insideSettings = false;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (PYDANTIC_BASESETTINGS_PATTERN.test(line)) {
        insideSettings = true;
        continue;
      }
      if (insideSettings && /^class\s+/.test(line)) {
        insideSettings = false;
      }
      if (!insideSettings) {
        continue;
      }
      const fieldMatch = PYDANTIC_FIELD_PATTERN.exec(line);
      const fieldName = fieldMatch?.[1];
      if (fieldName === undefined || fieldName === 'model_config') {
        continue;
      }
      declared.push({
        name: fieldName.toUpperCase(),
        surface: 'AI',
        group: 'ai',
        consumedBy: [relativePath],
        requiredByValidator: false, // pydantic fields with defaults are optional
        provenance: {
          sourceType: 'APPLICATION',
          sourceFile: relativePath,
          sourceLocation: `L${index + 1}`,
        },
      });
    }
  }
  return declared;
}

/** Scan mobile Expo config + all `EXPO_PUBLIC_*` reads across the mobile app. */
function scanMobileExpoPublic(repoRoot: string): DeclaredVariable[] {
  const declared: DeclaredVariable[] = [];

  const appConfigPath = join(repoRoot, MOBILE_APP_CONFIG);
  if (isFile(appConfigPath)) {
    declared.push(...collectExpoPublicFromFile(repoRoot, appConfigPath));
  }

  const mobileFiles = collectFiles(
    join(repoRoot, MOBILE_SRC_DIR),
    (name) => name.endsWith('.ts') || name.endsWith('.tsx'),
  );
  for (const absolutePath of mobileFiles) {
    declared.push(...collectExpoPublicFromFile(repoRoot, absolutePath));
  }
  return declared;
}

/** Extract `EXPO_PUBLIC_*` declared variables from a single mobile file. */
function collectExpoPublicFromFile(repoRoot: string, absolutePath: string): DeclaredVariable[] {
  const content = readSource(absolutePath);
  const relativePath = toRepoRelativePosix(repoRoot, absolutePath);
  const surface: Surface = 'MOBILE';
  const declared: DeclaredVariable[] = [];

  for (const [name, line] of extractExpoPublicNames(content)) {
    declared.push({
      name,
      surface,
      group: 'mobile',
      consumedBy: [relativePath],
      requiredByValidator: false, // client build-time values, not runtime-validated
      provenance: {
        sourceType: 'APPLICATION',
        sourceFile: relativePath,
        sourceLocation: `L${line}`,
      },
    });
  }
  return declared;
}
