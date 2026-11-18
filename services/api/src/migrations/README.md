# Migrations

## Purpose

TypeORM migrations that own the PostgreSQL schema. `synchronize` is disabled, so every schema change is a migration file (timestamp-prefixed, `up()` and `down()`, idempotent `IF NOT EXISTS` where possible). Deployed migrations are never edited; a new file is added instead.

## Files

| File | Creates / changes |
|------|-------------------|
| `1700000000000-CreateAuthTables.ts` | `users`, `auth_sessions`, `biometric_credentials`, `biometric_challenges` |
| `1700000001000-CreateRoleTables.ts` | Role columns on `users` (`roles`, `active_role`, onboarding statuses), `host_profiles`, `cleaner_profiles`, PostGIS extension |
| `1700000002000-CreateKycTables.ts` | `kyc_verifications`, `kyc_audit_logs` |
| `1700000003000-CreateProfileDetailsTables.ts` | `profile_details` |
| `1700000004000-CreateUserSettingsTable.ts` | `user_settings` |
| `1700000005000-CreatePortfolioPhotosTable.ts` | `portfolio_photos` |
| `1700000006000-AddDeletionStatusToUsers.ts` | Account-deletion columns on `users` |
| `1700000007000-CreatePropertiesTable.ts` | `properties` (PostGIS) |
| `1700000008000-CreatePropertyPhotosTable.ts` | `property_photos` |
| `1700000009000-CreatePropertyIdempotencyKeysTable.ts` | `property_idempotency_keys` |
| `1700000010000-CreateOffersTable.ts` | `offers` |
| `1700000011000-CreateOfferStateTransitionsTable.ts` | `offer_state_transitions` |
| `1700000012000-CreateOfferDeliveriesTable.ts` | `offer_deliveries` |
| `1700000013000-CreateNegotiationTables.ts` | `negotiation_threads`, `negotiation_proposals`, `negotiation_idempotency` |
| `1700000014000-CreatePaymentTables.ts` | `payments`, `payment_attempts`, `stripe_accounts`, `payment_events` |
| `1700000015000-CreateCommissionRules.ts` | `commission_rules` (uses the `btree_gist` extension) |
| `1700000016000-CreateCommissionRuleAudit.ts` | `commission_rule_audit` |
| `1700000017000-CreateSubscriptions.ts` | `subscriptions` |
| `1700000018000-CreateSubscriptionEvents.ts` | `subscription_events` |
| `1700000019000-CreateChatTables.ts` | `chat_conversations`, `chat_messages` |
| `1700000023000-CreateVoiceNoteTables.ts` | Voice columns on `chat_messages`, `chat_voice_notes`, `voice_note_upload_grants`, `voice_note_object_deletions` |
| `1700000030000-CreateDomainOutboxTables.ts` | `offer_outbox`, `payment_outbox`, `negotiation_outbox`, `chat_outbox`, `voip_outbox` |
| `1700000031000-CreateNotificationDevices.ts` | `notification_devices` |
| `1700000032000-CreateNotificationPreferences.ts` | `notification_preferences` |
| `1700000033000-CreateNotificationsLedger.ts` | `notifications` |
| `1700000034000-CreateOnesignalWebhookEvents.ts` | `onesignal_webhook_events` |
| `1700000040000-CreateVoipCallsTable.ts` | `voip_calls` |
| `1700000041000-CreateServiceTrackingTables.ts` | `service_sessions`, `service_outbox`, `service_outbox_consumers`, `service_activation_outbox`, `service_activation_consumed` |
| `1700000042000-CreateVideoVerificationTables.ts` | `verification_sessions`, `video_verification_upload_grants`, `video_verification_object_deletions`, `verification_outbox` |
| `1700000043000-CreateChecklistPhotoTables.ts` | `checklist_runs`, `checklist_tasks`, `checklist_task_photos`, `checklist_upload_grants`, `checklist_photo_object_deletions`, `checklist_outbox` |
| `1700000044000-CreateServiceCompletionTables.ts` | `service_completions`, `release_intents`, `service_ratings`, `completion_outbox`, `checklist_outbox_consumers` |
| `1700000045000-CreateDisputeSystemTables.ts` | `disputes`, `dispute_evidence`, `dispute_upload_grants`, `dispute_escrow_intents`, `dispute_financial_intents`, `dispute_object_deletions`, `dispute_outbox`, `completion_outbox_consumers`, plus a change to `payments` |
| `1700000046000-CreateFavorites.ts` | `favorites` |

## Dependencies

- `typeorm`, `pg`, PostgreSQL with the `postgis` and `btree_gist` extensions available.
- Data source: [`../config/typeorm.config.ts`](../config/README.md).

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string used by the TypeORM CLI | Yes |

## How to Run

```powershell
# PowerShell, from the repo root. The TypeORM CLI reads process.env only (it does not load .env),
# so set DATABASE_URL in the shell. Local compose Postgres is published on host port 15432.
$env:DATABASE_URL = "postgresql://bidclean:<password>@localhost:15432/bidclean"
npm run migration:run --workspace=services/api      # apply pending migrations
npm run migration:revert --workspace=services/api   # revert the last migration
npm run migration:generate --workspace=services/api -- src/migrations/<Name>
```

Test both directions (`run` then `revert`) before deploying a new migration.
