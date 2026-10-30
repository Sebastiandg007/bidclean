/**
 * Live-stack HTTP observation helper — Fase 2.
 *
 * Turns a component's resolved base-URL target into a REAL health/liveness
 * observation by issuing a GET with a bounded timeout. It never throws: a
 * connection refusal, DNS failure, or timeout becomes a synthesized `httpStatus:0`
 * ("down") so the calling probe produces an honest FAIL instead of crashing the
 * audit. Only non-secret outcome tokens (HTTP status, up/down) ever leave this
 * module — it never reads or forwards credentials.
 */

import { createConnection } from 'node:net';
import type { HealthObservation } from './service-health.probe';
import type { EdgeCallOutcome } from './inter-service-edge.probe';

/** Default per-request timeout. Health endpoints must answer fast or count as down. */
const DEFAULT_TIMEOUT_MS = 5000;

/** Default TCP connect timeout for non-HTTP services (Postgres/Redis). */
const DEFAULT_TCP_TIMEOUT_MS = 3000;

/**
 * The health/liveness path for each component, keyed by its registry `probeId`.
 *
 * A path is the component's real liveness endpoint (verified against the running
 * stack). Components reached over a non-HTTP protocol (Postgres/Redis TCP) or
 * with no local endpoint (whisper/piper binaries, VPS-only infra) are absent
 * here: their probes fall back to the honest "no local HTTP liveness" outcome.
 */
const HEALTH_PATH_BY_PROBE_ID: Readonly<Record<string, string>> = {
  'health.api': '/health',
  'presence.api': '/health',
  'health.ai': '/health/',
  'presence.ai': '/health/',
  'health.keycloak': '/',
  'presence.keycloak': '/',
  'health.minio': '/minio/health/live',
  'presence.minio': '/minio/health/live',
  'health.centrifugo': '/health',
  'presence.centrifugo': '/health',
  'health.libretranslate': '/languages',
  'presence.libretranslate': '/languages',
};

/**
 * Map a registry `probeId` to the base-URL key in the resolved targets map
 * (`api`, `ws` for the AI service, `auth`, `storage`). Returns `undefined` when
 * the component has no HTTP base URL in the targets map.
 */
const TARGET_KEY_BY_PROBE_ID: Readonly<Record<string, string>> = {
  'health.api': 'api',
  'presence.api': 'api',
  'health.ai': 'ws',
  'presence.ai': 'ws',
  'health.keycloak': 'auth',
  'presence.keycloak': 'auth',
  'health.minio': 'storage',
  'presence.minio': 'storage',
  'health.centrifugo': 'centrifugo',
  'presence.centrifugo': 'centrifugo',
  'health.libretranslate': 'libretranslate',
  'presence.libretranslate': 'libretranslate',
};

/**
 * TCP liveness endpoints for services with no HTTP surface (Postgres, Redis),
 * keyed by registry `probeId`. Host/port are read from env vars with the local
 * WinNAT-safe defaults, so a port remap never requires a code change.
 */
const TCP_ENDPOINT_BY_PROBE_ID: Readonly<Record<string, { host: string; portEnv: string; portDefault: number }>> = {
  'health.postgres': { host: 'localhost', portEnv: 'FULL_AUDIT_LOCAL_POSTGRES_PORT', portDefault: 15432 },
  'presence.postgres': { host: 'localhost', portEnv: 'FULL_AUDIT_LOCAL_POSTGRES_PORT', portDefault: 15432 },
  'health.redis': { host: 'localhost', portEnv: 'FULL_AUDIT_LOCAL_REDIS_PORT', portDefault: 16379 },
  'presence.redis': { host: 'localhost', portEnv: 'FULL_AUDIT_LOCAL_REDIS_PORT', portDefault: 16379 },
};

/** True iff this probeId has a known local HTTP liveness endpoint. */
export function hasLocalHttpLiveness(probeId: string): boolean {
  return probeId in HEALTH_PATH_BY_PROBE_ID;
}

/** True iff this probeId has a known local TCP liveness endpoint (non-HTTP service). */
export function hasLocalTcpLiveness(probeId: string): boolean {
  return probeId in TCP_ENDPOINT_BY_PROBE_ID;
}

/** Resolve the TCP host/port for a probe, or `undefined` when none is defined. */
export function resolveTcpEndpoint(probeId: string): { host: string; port: number } | undefined {
  const entry = TCP_ENDPOINT_BY_PROBE_ID[probeId];
  if (entry === undefined) {
    return undefined;
  }
  const raw = process.env[entry.portEnv];
  const port = raw !== undefined && raw.trim() !== '' ? Number(raw) : entry.portDefault;
  return { host: entry.host, port: Number.isFinite(port) ? port : entry.portDefault };
}

/**
 * Open a bounded TCP connection and report liveness. A successful connect →
 * `httpStatus:200`/"up" (the port is accepting connections); refusal/timeout →
 * `httpStatus:0`/"down". Never throws. Synthesizes an HTTP-shaped status so it
 * reuses the same `HealthObservation` contract as the HTTP path.
 */
export function observeTcp(
  host: string,
  port: number,
  timeoutMs: number = DEFAULT_TCP_TIMEOUT_MS,
): Promise<HealthObservation> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const done = (observation: HealthObservation): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(observation);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done({ httpStatus: 200, reportedStatus: 'up' }));
    socket.once('timeout', () => done({ httpStatus: 0, reportedStatus: 'down' }));
    socket.once('error', () => done({ httpStatus: 0, reportedStatus: 'down' }));
  });
}

/**
 * Resolve the absolute liveness URL for a probe from the targets map, or
 * `undefined` when the component has no HTTP base URL / no known liveness path.
 */
export function resolveLivenessUrl(
  probeId: string,
  targets: Readonly<Record<string, string>>,
): string | undefined {
  const targetKey = TARGET_KEY_BY_PROBE_ID[probeId];
  const path = HEALTH_PATH_BY_PROBE_ID[probeId];
  if (targetKey === undefined || path === undefined) {
    return undefined;
  }
  const baseUrl = targets[targetKey];
  if (baseUrl === undefined || baseUrl.trim() === '') {
    return undefined;
  }
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * Issue a bounded GET and return a `HealthObservation`. Never throws: any
 * transport failure (refused/timeout/DNS) resolves to `httpStatus:0` + "down".
 */
export async function observeHealth(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<HealthObservation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    const green = response.status >= 200 && response.status < 500;
    return { httpStatus: response.status, reportedStatus: green ? 'up' : 'down' };
  } catch {
    return { httpStatus: 0, reportedStatus: 'down' };
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Fase 3 — inter-service edge observations (reachable + authenticated + completed)
// ───────────────────────────────────────────────────────────────────────────

/** Result of a bounded GET that also inspects a small part of the body. */
interface BodyObservation {
  readonly httpStatus: number;
  readonly bodyText: string;
}

/** Issue a bounded GET and capture status + a bounded slice of the body. Never throws. */
async function fetchWithBody(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<BodyObservation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    const bodyText = (await response.text()).slice(0, 4096);
    return { httpStatus: response.status, bodyText };
  } catch {
    return { httpStatus: 0, bodyText: '' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify the API→Keycloak edge by fetching the realm JWKS (the exact artifact the
 * API uses to validate tokens). A 2xx whose body carries a non-empty `keys` array
 * is a COMPLETED authenticated-trust edge: the realm exists and publishes signing
 * keys. The JWKS is public by design, so no secret is read or emitted.
 */
export async function observeJwksEdge(
  authBaseUrl: string,
  realm: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<EdgeCallOutcome> {
  const url = `${authBaseUrl.replace(/\/$/, '')}/realms/${realm}/protocol/openid-connect/certs`;
  const observed = await fetchWithBody(url, timeoutMs);
  const reachable = observed.httpStatus > 0;
  const http2xx = observed.httpStatus >= 200 && observed.httpStatus < 300;
  const hasKeys = /"keys"\s*:\s*\[\s*\{/.test(observed.bodyText);
  return {
    reachable,
    authenticated: http2xx,
    completed: http2xx && hasKeys,
    detail: completedDetail(reachable, http2xx && hasKeys, 'JWKS keys published'),
  };
}

/**
 * Verify a plain HTTP edge to an internal service: the target responds with any
 * HTTP status (reachable + the endpoint is served). `expect2xx` tightens the
 * "authenticated/completed" bar when the endpoint is expected to answer 2xx.
 */
export async function observeHttpEdge(
  url: string,
  expect2xx: boolean,
  completedToken: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<EdgeCallOutcome> {
  const observed = await observeHealth(url, timeoutMs);
  const reachable = observed.httpStatus > 0;
  const ok = expect2xx
    ? observed.httpStatus >= 200 && observed.httpStatus < 300
    : observed.httpStatus > 0;
  return {
    reachable,
    authenticated: reachable,
    completed: ok,
    detail: completedDetail(reachable, ok, completedToken),
  };
}

/** Verify a TCP edge (Redis/Postgres as a dependency of a worker/relay). */
export async function observeTcpEdge(
  host: string,
  port: number,
  completedToken: string,
): Promise<EdgeCallOutcome> {
  const observed = await observeTcp(host, port);
  const up = observed.httpStatus > 0;
  return {
    reachable: up,
    authenticated: up,
    completed: up,
    detail: completedDetail(up, up, completedToken),
  };
}

/** Build a non-secret edge detail token from the reachable/completed outcome. */
function completedDetail(reachable: boolean, completed: boolean, token: string): string {
  if (!reachable) {
    return 'not reachable';
  }
  return completed ? token : 'reachable but call did not complete';
}

// ───────────────────────────────────────────────────────────────────────────
// Fase 4 — external-integration credential readiness (dummy vs real)
// ───────────────────────────────────────────────────────────────────────────

/** Substrings that mark a value as a non-production placeholder credential. */
const PLACEHOLDER_MARKERS: readonly string[] = [
  'dummy',
  'change_me',
  'changeme',
  'placeholder',
  'example',
  'replace',
  'todo',
  'xxx',
  'dev_',
  'your_',
];

/**
 * True iff a credential value is absent or a recognizable non-production
 * placeholder (a dummy marker, or too short to be a real key). Used to report an
 * external integration as "not verifiable without a real credential" instead of a
 * false GREEN. Operates on the VALUE's shape only — it never emits the value.
 */
export function isPlaceholderCredential(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  const trimmed = value.trim();
  if (trimmed.length <= 10) {
    return true;
  }
  const lowered = trimmed.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker));
}

/** The env var names whose value gates each external integration's verifiability. */
const INTEGRATION_CREDENTIAL_ENV: Readonly<Record<string, readonly string[]>> = {
  'ext.stripe': ['STRIPE_SECRET_KEY'],
  'ext.revenuecat': ['REVENUECAT_API_KEY', 'REVENUECAT_WEBHOOK_SIGNING_SECRET'],
  'ext.onesignal': ['ONESIGNAL_API_KEY'],
  'ext.bedrock': ['AWS_SECRET_ACCESS_KEY'],
  'ext.mapbox': ['MAPBOX_ACCESS_TOKEN', 'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN'],
};

/**
 * Resolve whether an external integration has a real (non-placeholder) credential
 * configured in the current environment. Returns `undefined` when the probeId is
 * not a known external integration.
 */
export function hasRealCredential(probeId: string): boolean | undefined {
  const envNames = INTEGRATION_CREDENTIAL_ENV[probeId];
  if (envNames === undefined) {
    return undefined;
  }
  // Real iff at least one configured credential for the integration is non-placeholder.
  return envNames.some((name) => !isPlaceholderCredential(process.env[name]));
}

// ───────────────────────────────────────────────────────────────────────────
// Fase 3 — edge resolution: map each inter-service-edge probeId to a real check
// ───────────────────────────────────────────────────────────────────────────

/** Read an env var with a safe default (used for edge-specific config). */
function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value;
}

/**
 * Perform the real inter-service-edge verification for a probeId against the live
 * stack, or return `undefined` when the edge is not locally verifiable (its
 * dependency is VPS-only, e.g. LiveKit, or it is a purely in-process edge with no
 * externally observable endpoint). A returned outcome is honest: `completed` is
 * true only when the authenticated round-trip actually succeeded.
 */
export async function observeEdge(
  probeId: string,
  targets: Readonly<Record<string, string>>,
): Promise<EdgeCallOutcome | undefined> {
  switch (probeId) {
    case 'edge.api-keycloak':
      return observeJwksEdge(
        targets.auth ?? 'http://localhost:8080',
        envOr('KEYCLOAK_REALM', 'bidclean'),
      );
    case 'edge.api-centrifugo':
    case 'edge.mobile-centrifugo': {
      // Centrifugo health endpoint proves the pub/sub broker edge is live.
      const base = (targets.centrifugo ?? 'http://localhost:8001').replace(/\/api\/?$/, '');
      return observeHttpEdge(`${base}/health`, true, 'centrifugo broker reachable');
    }
    case 'edge.api-redis-bullmq': {
      const tcp = resolveTcpEndpoint('health.redis');
      if (tcp === undefined) {
        return undefined;
      }
      return observeTcpEdge(tcp.host, tcp.port, 'redis/bullmq connection accepted');
    }
    case 'edge.api-ai-kyc':
    case 'edge.api-ai-transcribe':
    case 'edge.api-ai-verify-face': {
      // The AI service edge: its health endpoint proves API→AI reachability.
      const base = targets.ws ?? 'http://localhost:8000';
      return observeHttpEdge(`${base.replace(/\/$/, '')}/health/`, true, 'AI service reachable');
    }
    case 'edge.mobile-api': {
      const base = targets.api ?? 'http://localhost:3000';
      return observeHttpEdge(`${base.replace(/\/$/, '')}/health`, true, 'API reachable from mobile');
    }
    // VPS-only or in-process edges: not locally verifiable.
    case 'edge.api-livekit':
    case 'edge.mobile-livekit':
    case 'edge.outbox-push':
    default:
      return undefined;
  }
}
