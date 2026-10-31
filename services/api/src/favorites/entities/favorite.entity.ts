import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * favorites — the durable directed Host->Cleaner favorite relationship (Spec 22).
 *
 * Mirrors the `1700000046000-CreateFavorites` migration. A favorite is add-or-remove (hard delete),
 * so there is deliberately NO `updated_at`/`deleted_at`. Both user references cascade on delete
 * (a live relationship, not shared history). The reads/writes go through the raw-SQL
 * `FavoritesRepository`; this entity exists for TypeORM entity discovery (the entity glob) and typing.
 */
@Entity('favorites')
@Unique('uq_favorites_host_cleaner', ['hostId', 'cleanerId'])
export class Favorite {
  /** Surrogate UUID primary key. */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The Host who favorited (FK users, CASCADE). Indexed for the delivery/list host-scoped query. */
  @Index('idx_favorites_host')
  @Column({ name: 'host_id', type: 'uuid' })
  hostId!: string;

  /** The favorited Cleaner (FK users, CASCADE). Indexed for the cleaner-scoped aggregate count. */
  @Index('idx_favorites_cleaner')
  @Column({ name: 'cleaner_id', type: 'uuid' })
  cleanerId!: string;

  /** When the favorite was added; drives deterministic keyset pagination. */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
