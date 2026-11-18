/**
 * Registry of the six per-source scanners, one per configuration-source type.
 * The CLI runs all six and the model layer merges their output by name.
 */

import type { SourceScanner, SourceType } from '../inventory.model';
import { scanApplication } from './application-scanner';
import { scanBuild } from './build-scanner';
import { scanCi } from './ci-scanner';
import { scanDeploy } from './deploy-scanner';
import { scanInfra } from './infra-scanner';
import { scanRuntime } from './runtime-scanner';

/** One scanner per source type; completeness is audited against every entry. */
export const scanners: Record<SourceType, SourceScanner> = {
  APPLICATION: scanApplication,
  BUILD: scanBuild,
  DEPLOY: scanDeploy,
  INFRA: scanInfra,
  CI: scanCi,
  RUNTIME: scanRuntime,
};

export { scanApplication, scanBuild, scanCi, scanDeploy, scanInfra, scanRuntime };
