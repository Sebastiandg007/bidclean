/**
 * splash.ts — a thin, defensive wrapper around the native splash screen.
 *
 * The no-FOUC gate holds the native splash until the resolved themed tree is mounted and ready. We
 * wrap `expo-splash-screen` behind this module so:
 *   - the provider depends on a stable, tiny surface (`preventAutoHide` / `hide`);
 *   - if the native module is unavailable (not installed / not linked in a given build), the calls
 *     degrade to a safe no-op instead of throwing — the app must never crash or hang on the splash;
 *   - tests can mock this single module rather than the SDK.
 *
 * `hide()` never rejects to its caller: a failed native `hideAsync` is logged and swallowed here so
 * the gate logic stays simple (the themed tree is already the first painted frame).
 */

interface SplashModule {
  preventAutoHideAsync?: () => Promise<unknown>;
  hideAsync?: () => Promise<unknown>;
}

/** Resolve the native module lazily and defensively; returns `null` when unavailable. */
function loadSplashModule(): SplashModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-splash-screen') as SplashModule;
  } catch {
    return null;
  }
}

const splash = loadSplashModule();

/** Keep the native splash visible. Safe no-op if the module is unavailable. */
export function preventAutoHide(): void {
  try {
    void splash?.preventAutoHideAsync?.();
  } catch (error) {
    console.warn('[theme] preventAutoHide failed:', error);
  }
}

/** Hide the native splash. Never rejects to the caller; a failure is logged. */
export async function hide(): Promise<void> {
  try {
    await splash?.hideAsync?.();
  } catch (error) {
    console.warn('[theme] splash hide failed:', error);
  }
}
