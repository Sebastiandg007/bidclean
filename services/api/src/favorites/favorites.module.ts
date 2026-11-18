import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../auth/entities/user.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { validateFavoritesConfig } from './config/validate-favorites-config';
import { FavoriteEligibilityPolicy, DenyQualifyingServiceQuery } from './favorite-eligibility.policy';
import { FAVORITES_CACHE, FAVORITES_QUERY, QUALIFYING_SERVICE_QUERY } from './favorites.constants';
import { NoopFavoritesCacheService } from './favorites.cache';
import { FavoritesController } from './favorites.controller';
import { FavoritesRepository } from './favorites.repository';
import { FavoritesService } from './favorites.service';
import { Favorite } from './entities/favorite.entity';

/**
 * FavoritesModule (Spec 22 — Sprint 6, Polish & Extras).
 *
 * Owns the directed Host->Cleaner favorite relationship and its CRUD/query. Imports
 * `SubscriptionsModule` for the `SUBSCRIPTION_TIER` contract (the Host tier drives the count limit)
 * — one-directional, cycle-free coupling. EXPORTS `FAVORITES_QUERY` (implemented by
 * `FavoritesService`) so offer-radar (Spec 7) resolves `listFavoriteCleanerIds` / `isFavorite`
 * without depending on the CRUD surface.
 *
 * Seams bound here (the orchestrator may swap them — see WIRING.md):
 *  - `FAVORITES_CACHE` → the v1 NO-OP cache (always reads PostgreSQL, the authoritative membership).
 *  - `QUALIFYING_SERVICE_QUERY` → a fail-closed default (`false`); the real Spec 20 predicate is
 *    wired by the orchestrator. It is only consulted when `FAVORITES_ALLOW_ADD_WITHOUT_SERVICE=false`
 *    (the default `true` never consults it).
 *
 * Validates its configuration at startup (fail-fast, skipped under NODE_ENV=test).
 */
@Module({
  imports: [ConfigModule, SubscriptionsModule, TypeOrmModule.forFeature([Favorite, User])],
  controllers: [FavoritesController],
  providers: [
    FavoritesService,
    FavoritesRepository,
    FavoriteEligibilityPolicy,
    { provide: FAVORITES_CACHE, useClass: NoopFavoritesCacheService },
    { provide: QUALIFYING_SERVICE_QUERY, useClass: DenyQualifyingServiceQuery },
    { provide: FAVORITES_QUERY, useExisting: FavoritesService },
  ],
  exports: [FAVORITES_QUERY],
})
export class FavoritesModule implements OnModuleInit {
  onModuleInit(): void {
    validateFavoritesConfig();
  }
}
