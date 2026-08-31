/**
 * Jest global setup — runs before any module is imported (via `setupFiles`).
 *
 * Env-backed constants (e.g. commission and subscriptions config) are evaluated once at import
 * time, so any variable a unit test relies on must exist before the module graph loads. This
 * file seeds deterministic, non-secret test values for those variables. It NEVER contains real
 * credentials — production configuration is provided by the environment at deploy time.
 */

// RevenueCat entitlement id mapping (logical key -> lookup_key). Required for the mapper and
// RevenueCat client to translate entitlement ids in tests.
process.env.RC_ENTITLEMENT_CLEANER_PRO ??= 'cleaner_pro';
process.env.RC_ENTITLEMENT_HOST_PRO ??= 'host_pro';
process.env.RC_ENTITLEMENT_AD_FREE ??= 'ad_free';
