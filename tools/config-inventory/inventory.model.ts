/**
 * Canonical inventory model for the `secrets-inventory` tooling.
 *
 * These types are the single derived source of truth for a configuration
 * variable's existence, classification, and requiredness. `.env.example` is a
 * generated/reconciled PRESENTATION projection of this model — never an
 * authority feeding back into it. See design.md "Authority chain".
 */

/** Where a configuration variable belongs at runtime. */
export type Surface = 'API' | 'AI' | 'MOBILE' | 'INFRA';

/** Sensitivity classification of a configuration variable. */
export type Kind = 'SECRET' | 'CONFIG' | 'PUBLIC';

/**
 * Which configuration-source type discovered a variable.
 * Completeness is defined against this full taxonomy, not just constants files.
 */
export type SourceType =
  | 'APPLICATION' // *.constants.ts + validateXxxConfig(), pydantic, app.config.ts, EXPO_PUBLIC_* usage
  | 'BUILD' // eas.json build profiles, Expo build-time config, build-time tokens
  | 'DEPLOY' // deployment scripts, VPS env manifests, Traefik config
  | 'INFRA' // docker-compose*.yml (incl. ${VAR} interpolation), infra YAML/JSON
  | 'CI' // .github/workflows/*.yml env, codemagic.yaml env
  | 'RUNTIME'; // dynamic/indirect process.env / os.environ reads

/** Where a variable was discovered — its discovery provenance. */
export interface DiscoveryProvenance {
  readonly sourceType: SourceType;
  readonly sourceFile: string; // e.g. "services/api/src/payments/payments.constants.ts"
  readonly sourceLocation: string; // line number or section, e.g. "L42" or "jobs.api-tests.env"
}

/**
 * WHAT scope requires the variable. This axis is ORTHOGONAL to environment
 * applicability: it says which lifecycle scope needs the value, never in which
 * environments. Environment semantics live exclusively in `envApplicability`.
 */
export type RequiredScope =
  | 'runtime' // a fail-fast validator rejects startup without it
  | 'build' // needed at build-time (e.g. an EXPO_PUBLIC_* token)
  | 'deploy' // needed to deploy (VPS/deploy scripts) but not local runtime
  | 'infra'; // needed by a docker-compose service bootstrap

/**
 * WHICH environments the variable applies to. This is the ONLY place
 * environment semantics are expressed (orthogonal to `requiredScope`).
 */
export type EnvApplicability = ReadonlyArray<'local' | 'staging' | 'production'>;

/** Structured justification for a deliberately-kept orphan — never free text. */
export interface OrphanJustification {
  readonly type: 'LEGACY' | 'BUILD_ONLY' | 'EXTERNAL_TOOL' | 'DEPRECATED';
  readonly owner: string; // team/person accountable for the orphan
  readonly expiresAt: string; // ISO date after which the orphan must be revisited
}

/** A single catalogued configuration variable in the canonical model. */
export interface ConfigVariable {
  readonly name: string; // e.g. STRIPE_SECRET_KEY
  readonly surface: Surface;
  readonly group: string; // owning module/section, e.g. "payments"
  readonly kind: Kind;
  readonly requiredScope: readonly RequiredScope[]; // WHAT scope (orthogonal axis)
  readonly envApplicability: EnvApplicability; // WHICH environments (orthogonal axis)
  readonly placeholder: string; // safe placeholder, NEVER a real value
  readonly consumedBy: readonly string[]; // consts/validators/services that read it
  readonly provenance: readonly DiscoveryProvenance[]; // WHERE it was discovered (>=1)
  readonly orphanJustification?: OrphanJustification; // present only for justified orphans
  readonly notes?: string;
}

/** Machine-checkable finding codes emitted by reconcile/classify/exposure. */
export type FindingCode =
  | 'MISSING_IN_ENV_EXAMPLE' // a source reads it, .env.example lacks it
  | 'ORPHANED_ENV_EXAMPLE' // .env.example declares it, no source reads it
  | 'REQUIRED_MISMATCH' // required-vs-optional drift vs validator
  | 'SECRET_ON_CLIENT' // a SECRET exposed on the MOBILE surface
  | 'SECRET_EXPOSURE'; // a known secret pattern detected in a tracked artifact

/** A single reconciliation / classification / exposure finding. */
export interface Finding {
  readonly code: FindingCode;
  readonly variable?: string;
  readonly detail: string;
  readonly blocking: boolean; // SECRET_EXPOSURE and SECRET_ON_CLIENT are blocking
}

/** The aggregated report the CLI and CI consume. */
export interface InventoryReport {
  readonly variables: readonly ConfigVariable[];
  readonly findings: readonly Finding[];
  readonly compliant: boolean; // false if any blocking finding exists
}

/**
 * A variable as emitted by a single per-source scanner, before merge into the
 * canonical model. Each scanner attaches exactly one `DiscoveryProvenance`.
 */
export interface DeclaredVariable {
  name: string;
  surface: Surface;
  group: string;
  consumedBy: string[];
  requiredByValidator: boolean;
  provenance: DiscoveryProvenance; // WHERE this scanner found it
}

/** A per-source scanner: given the repo root, returns the variables it discovered. */
export type SourceScanner = (repoRoot: string) => DeclaredVariable[];
