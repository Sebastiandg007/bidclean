import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Service activation consumed entity (Spec 17).
 *
 * Maps to `service_activation_consumed`: service-tracking's own per-consumer checkpoint over the
 * upstream `service_activation_outbox`. Because service-tracking does not own that upstream table,
 * it records its consumption progress here (a `NOT EXISTS` join key) rather than mutating a shared
 * `relayed_at`. `createFromActivation` remains idempotent on `UNIQUE offer_id` as the backstop.
 */
@Entity('service_activation_consumed')
@Unique('uq_service_activation_consumed_event', ['upstreamEventId'])
export class ServiceActivationConsumed {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The offer/escrow outbox `event_id` service-tracking has consumed (no cross-context FK). */
  @Column({ name: 'upstream_event_id', type: 'varchar', length: 255 })
  upstreamEventId!: string;

  @CreateDateColumn({ name: 'consumed_at', type: 'timestamptz' })
  consumedAt!: Date;
}
