/**
 * Classifier: assigns `kind`, `requiredScope`, `envApplicability`, and a safe
 * placeholder to each merged variable, and runs the public/secret boundary
 * check. Classification is by rule + explicit override, then VERIFIED against
 * where the value flows (client bundle vs server) — never trusted by naming
 * alone. The `EXPO_PUBLIC_` prefix does not, by itself, prove a value is safe.
 */

import type {
  ConfigVariable,
  DeclaredVariable,
  Finding,
  Kind,
  RequiredScope,
  Surface,
} from './inventory.model';

/** A variable merged across all scanners, before classification. */
export interface MergedVariable {
  readonly name: string;
  readonly surface: Surface;
  readonly group: string;
  readonly consumedBy: readonly string[];
  readonly requiredByValidator: boolean;
  readonly provenance: ConfigVariable['provenance'];
  readonly sourceTypes: ReadonlySet<ConfigVariable['provenance'][number]['sourceType']>;
}

/** Safe placeholder emitted for a SECRET-kind variable. */
export const SECRET_PLACEHOLDER = 'CHANGE_ME';
/** Safe placeholder emitted for a PUBLIC client value. */
export const PUBLIC_PLACEHOLDER = 'public-value-here';
/** Safe placeholder emitted for a non-secret CONFIG value. */
export const CONFIG_PLACEHOLDER = 'value-here';

const EXPO_PUBLIC_PREFIX = 'EXPO_PUBLIC_';

/**
 * Server-side candidate-SECRET name fragments. Applied to non-client surfaces
 * (API/AI/INFRA) to classify server credentials.
 */
const SECRET_NAME_PATTERNS: readonly RegExp[] = [
  /_SECRET$/,
  /_SECRET_/,
  /_API_KEY$/,
  /_PASSWORD$/,
  /_PRIVATE_KEY$/,
  /_ACCESS_KEY$/,
  /_ACCESS_KEY_ID$/,
  /_AUTH_TOKEN$/,
  /_SIGNING_SECRET$/,
  /_WEBHOOK_SECRET$/,
  /_TOKEN_SECRET$/,
  /^AWS_SECRET_ACCESS_KEY$/,
];

/**
 * HARD server-secret fragments: names that are unambiguously server credentials
 * and must NEVER reach the client. A `EXPO_PUBLIC_*` name matching one of these
 * is a mis-prefixed secret (caught by the boundary check), whereas a generic
 * `_SECRET`/`_TOKEN` suffix on a client value (e.g. a client-safe attribution
 * salt or a publishable/public map token) is NOT a hard server secret.
 */
const HARD_SECRET_NAME_PATTERNS: readonly RegExp[] = [
  /_SECRET_KEY$/,
  /_API_KEY$/,
  /_PASSWORD$/,
  /_PRIVATE_KEY$/,
  /_SIGNING_SECRET$/,
  /_WEBHOOK_SECRET$/,
  /^AWS_SECRET_ACCESS_KEY$/,
];

/** Names that carry a secret-ish fragment but are NOT secrets (explicit allow). */
const NON_SECRET_OVERRIDES: ReadonlySet<string> = new Set([
  'STRIPE_PUBLISHABLE_KEY', // publishable key is client-safe by Stripe's design
  'CENTRIFUGO_API_URL',
  'REVENUECAT_API_URL',
]);

/** Object-storage credential names that must never appear on the AI surface. */
const STORAGE_CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /^MINIO_/,
  /_MINIO_/,
  /^AWS_ACCESS_KEY_ID$/,
  /^AWS_SECRET_ACCESS_KEY$/,
  /^S3_/,
];

/**
 * Classify one merged variable into a full `ConfigVariable`.
 *
 * @param merged - The merged variable produced by the model layer.
 * @returns The classified canonical variable.
 */
export function classifyVariable(merged: MergedVariable): ConfigVariable {
  const kind = classifyKind(merged.name, merged.surface);
  const requiredScope = deriveRequiredScope(merged);
  const envApplicability = deriveEnvApplicability(merged.name, kind);
  const placeholder = placeholderForKind(kind);

  return {
    name: merged.name,
    surface: merged.surface,
    group: merged.group,
    kind,
    requiredScope,
    envApplicability,
    placeholder,
    consumedBy: merged.consumedBy,
    provenance: merged.provenance,
  };
}

/** Classify the sensitivity kind of a variable (candidate, verified later). */
export function classifyKind(name: string, surface: Surface): Kind {
  const isClientSurface = surface === 'MOBILE' || name.startsWith(EXPO_PUBLIC_PREFIX);
  if (isClientSurface) {
    // Client values are PUBLIC by intent; only a HARD server-secret fragment
    // (e.g. a mis-prefixed EXPO_PUBLIC_STRIPE_SECRET_KEY) overrides to SECRET so
    // the boundary check catches it — a generic _SECRET/_TOKEN suffix does not.
    return matchesHardSecretName(name) ? 'SECRET' : 'PUBLIC';
  }
  if (matchesSecretName(name)) {
    return 'SECRET';
  }
  return 'CONFIG';
}

/** True when a name matches any server-side candidate-secret pattern. */
function matchesSecretName(name: string): boolean {
  if (NON_SECRET_OVERRIDES.has(name)) {
    return false;
  }
  return SECRET_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/** True when a name is unambiguously a HARD server secret (never client-safe). */
export function matchesHardSecretName(name: string): boolean {
  if (NON_SECRET_OVERRIDES.has(name)) {
    return false;
  }
  return HARD_SECRET_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/** True when a name denotes an object-storage credential. */
export function isStorageCredential(name: string): boolean {
  return STORAGE_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Derive the required-scope tuple. The two axes are orthogonal: scope tokens are
 * drawn only from {runtime, build, deploy, infra}. A validator-required variable
 * is `runtime`; source types contribute `build`/`deploy`/`infra` scopes.
 */
function deriveRequiredScope(merged: MergedVariable): readonly RequiredScope[] {
  const scopes = new Set<RequiredScope>();
  if (merged.requiredByValidator) {
    scopes.add('runtime');
  }
  if (merged.sourceTypes.has('BUILD')) {
    scopes.add('build');
  }
  if (merged.sourceTypes.has('DEPLOY')) {
    scopes.add('deploy');
  }
  if (merged.sourceTypes.has('INFRA') || merged.sourceTypes.has('CI')) {
    scopes.add('infra');
  }
  if (scopes.size === 0) {
    // Read by an application/runtime surface but not validator-required: it is a
    // runtime-consumed optional value; the runtime scope reflects where it is read.
    scopes.add('runtime');
  }
  return orderScopes(scopes);
}

/** Return scopes in a stable, deterministic order. */
function orderScopes(scopes: ReadonlySet<RequiredScope>): readonly RequiredScope[] {
  const order: readonly RequiredScope[] = ['runtime', 'build', 'deploy', 'infra'];
  return order.filter((scope) => scopes.has(scope));
}

/**
 * Derive environment applicability (orthogonal to scope). A live-only credential
 * (Stripe/RevenueCat/AWS/OneSignal secret) applies to staging+production; every
 * other variable applies to all environments so local bring-up stays complete.
 */
function deriveEnvApplicability(name: string, kind: Kind): ConfigVariable['envApplicability'] {
  const liveOnlyPrefixes: readonly string[] = [
    'STRIPE_',
    'REVENUECAT_',
    'AWS_',
    'ONESIGNAL_',
  ];
  if (kind === 'SECRET' && liveOnlyPrefixes.some((prefix) => name.startsWith(prefix))) {
    return ['staging', 'production'];
  }
  return ['local', 'staging', 'production'];
}

/** Return the safe placeholder for a given kind (never a real value). */
export function placeholderForKind(kind: Kind): string {
  switch (kind) {
    case 'SECRET':
      return SECRET_PLACEHOLDER;
    case 'PUBLIC':
      return PUBLIC_PLACEHOLDER;
    case 'CONFIG':
      return CONFIG_PLACEHOLDER;
    default:
      return CONFIG_PLACEHOLDER;
  }
}

/**
 * Run the public/secret boundary check over the classified catalog:
 *   - a SECRET on the MOBILE surface (or an `EXPO_PUBLIC_*` classified SECRET)
 *     yields a blocking `SECRET_ON_CLIENT` finding;
 *   - an object-storage credential assigned to the AI surface yields a blocking
 *     `SECRET_ON_CLIENT` finding (Option A: AI holds no storage creds).
 *
 * @param variables - The classified catalog.
 * @returns Boundary findings (empty when the boundary holds).
 */
export function checkBoundary(variables: readonly ConfigVariable[]): Finding[] {
  const findings: Finding[] = [];
  for (const variable of variables) {
    if (isSecretOnClient(variable)) {
      findings.push({
        code: 'SECRET_ON_CLIENT',
        variable: variable.name,
        detail: `SECRET '${variable.name}' is exposed on the client (MOBILE/EXPO_PUBLIC) surface`,
        blocking: true,
      });
    }
    if (variable.surface === 'AI' && isStorageCredential(variable.name)) {
      findings.push({
        code: 'SECRET_ON_CLIENT',
        variable: variable.name,
        detail: `Storage credential '${variable.name}' must not be assigned to the AI surface (Option A)`,
        blocking: true,
      });
    }
  }
  return findings;
}

/** True when a variable is a SECRET that reaches the client surface. */
function isSecretOnClient(variable: ConfigVariable): boolean {
  if (variable.kind !== 'SECRET') {
    return false;
  }
  return variable.surface === 'MOBILE' || variable.name.startsWith(EXPO_PUBLIC_PREFIX);
}

/** Kept for callers that need to know a declared variable's group verbatim. */
export function groupOf(declared: DeclaredVariable): string {
  return declared.group;
}
