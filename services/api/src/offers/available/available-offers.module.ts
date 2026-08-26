import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AvailableOffersController } from './available-offers.controller';
import { AvailableOffersService } from './available-offers.service';
import { AvailableOffersRepository } from './available-offers.repository';
import { User } from '../../auth/entities/user.entity';

/**
 * Available offers sub-module.
 *
 * Provides the Cleaner-facing available offers endpoints:
 * - GET /offers/available (paginated, filtered, sorted)
 * - GET /offers/available/snapshot (full reconciliation set)
 *
 * This module is imported by the parent OffersModule and shares
 * the same database connection (DataSource) for PostGIS queries.
 *
 * Dependencies:
 * - User entity (for Cleaner role resolution from JWT)
 * - DataSource (injected into repository for raw SQL + PostGIS)
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [AvailableOffersController],
  providers: [AvailableOffersService, AvailableOffersRepository],
  exports: [AvailableOffersService],
})
export class AvailableOffersModule {}
