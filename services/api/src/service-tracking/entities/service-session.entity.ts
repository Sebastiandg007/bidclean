import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Service session entity (Spec 17).
 *
 * Maps to `service_sessions`: the durable execution lifecycle of a matched+charged offer, from
 * `MATCHED` through `IN_PROGRESS`, plus terminal `CANCELED | EXPIRED`. It never holds live
 * coordinates — only the scalar `arrivalDistanceM` persists as location-derived data, and there is
 * intentionally no `deletedAt` (a terminal-for-tracking session is an immutable audit fact).
 *
 * FK deletion policy (mirrors the migration): `offerId` CASCADE; `hostId`/`cleanerId`/`propertyId`
 * SET NULL (never a user-cascade) so history survives a deleted/anonymized participant or a
 * deleted property. The geofence uses `propertyLocationSnapshot`, not the live property row.
 * Partial indexes (sweep) are declared in the migration since TypeORM cannot express partial
 * `WHERE` clauses; the non-partial constraints are declared here for parity.
 */
@Entity('service_sessions')
@Unique('uq_service_sessions_offer', ['offerId'])
@Check(
  'chk_service_sessions_state',
  `"state" IN ('MATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'CANCELED', 'EXPIRED')`,
)
@Check(
  'chk_service_sessions_ended_reason',
  `"ended_reason" IS NULL OR "ended_reason" IN ('STARTED', 'CANCELED_OFFER_TERMINAL', 'CANCELED_BY_PARTICIPANT', 'EXPIRED_NO_PROGRESS', 'EXPIRED_NEVER_STARTED', 'EXPIRED_PROPERTY_REMOVED')`,
)
@Index('idx_service_sessions_host', ['hostId'])
@Index('idx_service_sessions_cleaner', ['cleanerId'])
@Index('idx_service_sessions_property', ['propertyId'])
export class ServiceSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The matched offer this session belongs to (FK CASCADE, UNIQUE); one session per offer. */
  @Column({ name: 'offer_id', type: 'uuid' })
  offerId!: string;

  /** Host user id; nullable so a deleted/anonymized user does not destroy session history. */
  @Column({ name: 'host_id', type: 'uuid', nullable: true })
  hostId!: string | null;

  /** Cleaner user id; nullable so a deleted/anonymized user does not destroy session history. */
  @Column({ name: 'cleaner_id', type: 'uuid', nullable: true })
  cleanerId!: string | null;

  /** Property id; nullable (SET NULL). The geofence uses the snapshot below, not this row. */
  @Column({ name: 'property_id', type: 'uuid', nullable: true })
  propertyId!: string | null;

  /** Geofence centre captured at creation (PostGIS geography); survives a property deletion. */
  @Column({ name: 'property_location_snapshot', type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  propertyLocationSnapshot!: string;

  /** Radius (metres) snapshotted from config at creation. */
  @Column({ name: 'geofence_radius_m', type: 'integer' })
  geofenceRadiusM!: number;

  /** Lifecycle state: MATCHED|EN_ROUTE|ARRIVED (non-terminal) or the terminal set (immutable). */
  @Column({ type: 'varchar', length: 20, default: 'MATCHED' })
  state!: string;

  /** Differentiated end reason paired with a terminal state; null while non-terminal. */
  @Column({ name: 'ended_reason', type: 'varchar', length: 30, nullable: true })
  endedReason!: string | null;

  /** Set on MATCHED → EN_ROUTE. */
  @Column({ name: 'en_route_at', type: 'timestamptz', nullable: true })
  enRouteAt!: Date | null;

  /** Set on EN_ROUTE → ARRIVED (server timestamp, not the client `at`). */
  @Column({ name: 'arrived_at', type: 'timestamptz', nullable: true })
  arrivedAt!: Date | null;

  /** Set on ARRIVED → IN_PROGRESS. */
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  /** The ONLY durable location-derived datum; server-observed distance at the geofence crossing. */
  @Column({ name: 'arrival_distance_m', type: 'integer', nullable: true })
  arrivalDistanceM!: number | null;

  /** Scalar timestamp updated on each eligible EN_ROUTE sample; drives the stale sweep. */
  @Column({ name: 'last_progress_at', type: 'timestamptz', nullable: true })
  lastProgressAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
