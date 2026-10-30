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
