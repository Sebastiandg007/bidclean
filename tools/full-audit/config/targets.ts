/**
 * Per-environment target resolution.
 *
 * Targets (endpoints/subdomains) are resolved per environment from environment
 * variables with safe non-secret defaults — NEVER hardcoded endpoints inside
 * probe logic. A probe receives only the resolved `targets` map, so the same
 * invariant is checked with an environment-appropriate probe (localhost vs
 * public subdomain).
 */

import type { Environment } from '../checklist/checklist.model';

/** Resolve the base-URL targets for an environment from env vars (with defaults). */
export function resolveTargets(environment: Environment): Readonly<Record<string, string>> {
  if (environment === 'vps') {
    return {
      api: env('FULL_AUDIT_VPS_API_URL', 'https://api.bidclean.tech'),
      ws: env('FULL_AUDIT_VPS_WS_URL', 'https://ws.bidclean.tech'),
      rtc: env('FULL_AUDIT_VPS_RTC_URL', 'https://rtc.bidclean.tech'),
      storage: env('FULL_AUDIT_VPS_STORAGE_URL', 'https://storage.bidclean.tech'),
      auth: env('FULL_AUDIT_VPS_AUTH_URL', 'https://auth.bidclean.tech'),
    };
  }
  return {
    api: env('FULL_AUDIT_LOCAL_API_URL', 'http://localhost:3000'),
    ws: env('FULL_AUDIT_LOCAL_WS_URL', 'http://localhost:8000'),
    rtc: env('FULL_AUDIT_LOCAL_RTC_URL', 'http://localhost:7880'),
    storage: env('FULL_AUDIT_LOCAL_STORAGE_URL', 'http://localhost:9000'),
    auth: env('FULL_AUDIT_LOCAL_AUTH_URL', 'http://localhost:8080'),
  };
}

/**
 * Whether the live stack is reachable for this run. Fase 1 defaults to false, so
 * edge/integration/journey probes return an honest FAIL rather than a crash or a
 * silent N/A. Fase 2 sets FULL_AUDIT_LIVE_STACK=1 once the stack is up.
 */
export function isLiveStackAvailable(): boolean {
  return process.env.FULL_AUDIT_LIVE_STACK === '1';
}

/** Read an env var with a safe non-secret default. */
function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value;
}
