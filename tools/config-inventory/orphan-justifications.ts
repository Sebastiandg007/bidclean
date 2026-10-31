/**
 * Curated registry of structured `OrphanJustification`s for `.env.example`
 * entries that are deliberately kept even though no code path reads them yet.
 *
 * An orphan is either removed or kept with a structured justification (never a
 * free-text note). Each justification is accountable (an `owner`) and
 * time-bounded (an `expiresAt`) so it cannot silently rot; CI can surface a
 * justification past its `expiresAt` for removal.
 *
 * Two orphan categories are justified here:
 *   - BUILD_ONLY / EXTERNAL_TOOL: declared for a runtime consumer that reads the
 *     value outside the scanned application code (infra service, cloud SDK,
 *     external MCP tooling) — e.g. AWS Bedrock creds, LibreTranslate URL.
 *   - LEGACY: documented in `.env.example` but the owning module currently
 *     hardcodes the value as a constant (a known, tracked gap to re-wire).
 */

import type { OrphanJustification } from './inventory.model';

/** A far-future review date shared by the initial justification batch. */
const REVIEW_DATE = '2026-06-30';

/** Justification for a cloud/external-tool credential consumed outside app code. */
function externalTool(owner: string): OrphanJustification {
  return { type: 'EXTERNAL_TOOL', owner, expiresAt: REVIEW_DATE };
}

/** Justification for an infra/service value consumed by a container, not app code. */
function buildOnly(owner: string): OrphanJustification {
  return { type: 'BUILD_ONLY', owner, expiresAt: REVIEW_DATE };
}

/** Justification for a documented value the owning module currently hardcodes. */
function legacy(owner: string): OrphanJustification {
  return { type: 'LEGACY', owner, expiresAt: REVIEW_DATE };
}

/**
 * The justification registry, keyed by variable name. Only names present here
 * are allowed to remain orphaned without producing an `ORPHANED_ENV_EXAMPLE`
 * finding.
 */
export const ORPHAN_JUSTIFICATIONS: Readonly<Record<string, OrphanJustification>> = {
  // AWS Bedrock credentials — consumed by the AWS SDK / Bedrock runtime, not by
  // first-party application code that the scanners read.
  AWS_REGION: externalTool('ai-platform'),
  AWS_ACCESS_KEY_ID: externalTool('ai-platform'),
  AWS_SECRET_ACCESS_KEY: externalTool('ai-platform'),

  // LibreTranslate endpoint — consumed by the self-hosted translation service.
  LIBRE_TRANSLATE_URL: buildOnly('platform'),

  // Keycloak OAuth endpoints + realm URLs — consumed by the Keycloak container
  // and OAuth client flows configured outside the scanned application reads.
  KEYCLOAK_URL: buildOnly('auth'),
  KEYCLOAK_JWKS_URI: buildOnly('auth'),
  KEYCLOAK_TOKEN_ENDPOINT: buildOnly('auth'),
  KEYCLOAK_AUTHORIZATION_ENDPOINT: buildOnly('auth'),
  KEYCLOAK_REDIRECT_URI: buildOnly('auth'),
  KEYCLOAK_MOBILE_REDIRECT_SCHEME: buildOnly('auth'),

  // RevenueCat v2/admin identifiers — reserved for RevenueCat MCP/admin tooling.
  REVENUECAT_API_V2_SECRET: externalTool('monetization'),
  REVENUECAT_PROJECT_ID: externalTool('monetization'),

  // Values documented in .env.example but currently hardcoded as module
  // constants (tracked re-wiring gap; owning modules keep the literal for now).
  KYC_MAX_CONCURRENT: legacy('kyc'),
  KYC_MAX_RETRY_ATTEMPTS: legacy('kyc'),
  KYC_MIN_IMAGE_HEIGHT: legacy('kyc'),
  KYC_MIN_IMAGE_WIDTH: legacy('kyc'),
  KYC_RATE_LIMIT_PER_HOUR: legacy('kyc'),
  PROFILE_NAME_MAX_LENGTH: legacy('profile'),
  PROFILE_RATE_LIMIT_PER_MINUTE: legacy('profile'),
  PROFILE_UPLOAD_TIMEOUT_MS: legacy('profile'),
  PROPERTY_MAX_BATHROOMS: legacy('properties'),
  PROPERTY_MAX_BEDROOMS: legacy('properties'),
  PROPERTY_MAX_CHECKLIST_ITEMS: legacy('properties'),
  PROPERTY_MAX_REQUIREMENTS: legacy('properties'),
  PROPERTY_MAX_SQM: legacy('properties'),
  PROPERTY_RATE_LIMIT_PER_MINUTE: legacy('properties'),
  PROPERTY_UPLOAD_TIMEOUT_MS: legacy('properties'),
};

/** The set of variable names that carry a valid structured justification. */
export const JUSTIFIED_ORPHAN_NAMES: ReadonlySet<string> = new Set(
  Object.keys(ORPHAN_JUSTIFICATIONS),
);
