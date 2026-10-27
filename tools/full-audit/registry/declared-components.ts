/**
 * Operator-maintained declared-component set — the registry's source of truth.
 *
 * Day-one this is a DOCUMENTED MANUAL REVIEW (mirroring how `secrets-inventory`
 * treats its owning-artifact reconciliation): before an audit the operator
 * reconciles `component-registry.yaml` against the owning specs (1–24) and
 * `docs/ARCHITECTURE.md` topology, and records the authoritative set here. The
 * reconciliation step (registry-reconcile.ts) then flags any divergence as a
 * blocking REGISTRY_STALE finding BEFORE the checklist is built. This MAY later
 * be automated into a probe, but the manual review is the day-one bar.
 */

/** A component declared by an owning spec / the ARCHITECTURE topology. */
export interface DeclaredComponent {
  /** Must match a registry `componentId` when the two are reconciled. */
  readonly componentId: string;
  /** Owning spec/module accountable for it (finding routing target). */
  readonly owner: string;
}

/**
 * The authoritative declared set, reconciled by the operator against the specs
 * and ARCHITECTURE on 2024-06. Kept in sync with `component-registry.yaml`; any
 * drift surfaces as REGISTRY_STALE until this and the YAML agree.
 */
export const DECLARED_COMPONENTS: readonly DeclaredComponent[] = [
  // Top-level services + infra
  { componentId: 'svc.api', owner: 'services/api' },
  { componentId: 'svc.ai', owner: 'services/ai' },
  { componentId: 'svc.mobile-build', owner: 'apps/mobile' },
  { componentId: 'svc.postgres', owner: 'infra' },
  { componentId: 'svc.redis', owner: 'infra' },
  { componentId: 'svc.minio', owner: 'infra' },
  { componentId: 'svc.keycloak', owner: 'user-authentication' },
  { componentId: 'svc.centrifugo', owner: 'realtime-chat' },
  { componentId: 'svc.livekit', owner: 'voip-calls' },
  { componentId: 'svc.libretranslate', owner: 'realtime-chat' },
  { componentId: 'svc.whisper', owner: 'voice-notes' },
  { componentId: 'svc.piper', owner: 'voice-notes' },
  { componentId: 'svc.traefik', owner: 'infra' },
  { componentId: 'svc.prometheus-grafana-loki', owner: 'infra' },
  { componentId: 'svc.sentry', owner: 'infra' },
  { componentId: 'svc.uptime-kuma', owner: 'infra' },
  // AI endpoints
  { componentId: 'ai.transcribe', owner: 'voice-notes' },
  { componentId: 'ai.verify-face', owner: 'video-verification' },
  { componentId: 'ai.kyc', owner: 'kyc-verification' },
  // API Nest feature modules
  { componentId: 'api.module.auth', owner: 'user-authentication' },
  { componentId: 'api.module.offers', owner: 'offer-publishing' },
  { componentId: 'api.module.payments', owner: 'stripe-escrow' },
  { componentId: 'api.module.subscriptions', owner: 'revenuecat-subscriptions' },
  { componentId: 'api.module.notifications', owner: 'push-notifications' },
  { componentId: 'api.module.chat', owner: 'realtime-chat' },
  // API BullMQ workers
  { componentId: 'api.worker.radius-expansion', owner: 'offer-radar' },
  { componentId: 'api.worker.tier-delivery', owner: 'offer-radar' },
  { componentId: 'api.worker.favorites-window', owner: 'favorites' },
  { componentId: 'api.worker.stripe-webhook', owner: 'stripe-escrow' },
  { componentId: 'api.worker.notifications-delivery', owner: 'push-notifications' },
  { componentId: 'api.worker.revenuecat-webhook', owner: 'revenuecat-subscriptions' },
  { componentId: 'api.worker.face-comparison', owner: 'video-verification' },
  { componentId: 'api.worker.voice-transcription', owner: 'voice-notes' },
  // API outbox relay + durable consumers
  { componentId: 'api.relay.notifications-outbox', owner: 'push-notifications' },
  { componentId: 'api.listener.offer-matched-escrow', owner: 'stripe-escrow' },
  { componentId: 'api.consumer.service-activation', owner: 'service-tracking' },
  { componentId: 'api.consumer.verification-arrival', owner: 'video-verification' },
  { componentId: 'api.consumer.completion-created', owner: 'service-completion' },
  { componentId: 'api.consumer.dispute-created', owner: 'dispute-system' },
  // API scheduled jobs
  { componentId: 'api.job.payment-reconciliation', owner: 'stripe-escrow' },
  { componentId: 'api.job.auto-release', owner: 'service-completion' },
  { componentId: 'api.job.service-sweep', owner: 'service-tracking' },
  // API webhook ingresses
  { componentId: 'api.webhook.stripe', owner: 'stripe-escrow' },
  { componentId: 'api.webhook.revenuecat', owner: 'revenuecat-subscriptions' },
  { componentId: 'api.webhook.onesignal', owner: 'push-notifications' },
  { componentId: 'api.webhook.livekit', owner: 'voip-calls' },
  // External integrations
  { componentId: 'ext.stripe', owner: 'stripe-escrow' },
  { componentId: 'ext.revenuecat', owner: 'revenuecat-subscriptions' },
  { componentId: 'ext.onesignal', owner: 'push-notifications' },
  { componentId: 'ext.bedrock', owner: 'services/ai' },
  { componentId: 'ext.mapbox', owner: 'apps/mobile' },
  // Mobile feature modules
  { componentId: 'mobile.feature.radar', owner: 'offer-radar' },
  { componentId: 'mobile.feature.tracking', owner: 'service-tracking' },
  { componentId: 'mobile.feature.chat', owner: 'realtime-chat' },
  { componentId: 'mobile.feature.payments', owner: 'stripe-escrow' },
];
