import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { PropertiesRepository } from './properties.repository';
import { PropertyPhotoService } from './photo/property-photo.service';
import { GeocodingService } from './geocoding/geocoding.service';
import { PropertyOwnerGuard } from './guards/property-owner.guard';
import { Property } from './entities/property.entity';
import { PropertyPhoto } from './entities/property-photo.entity';
import { User } from '../auth/entities/user.entity';

/**
 * Properties module.
 *
 * Manages property CRUD for Hosts: creation with idempotency,
 * photo management (MinIO AES-256 encryption, transactional ordering),
 * geocoding (Mapbox forward/reverse via server-side proxy),
 * PostGIS spatial storage with location_source tracking,
 * address privacy enforcement via dedicated SELECT queries,
 * and offer-readiness calculation.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Property, PropertyPhoto, User]),
  ],
  controllers: [PropertiesController],
  providers: [
    PropertiesService,
    PropertiesRepository,
    PropertyPhotoService,
    GeocodingService,
    PropertyOwnerGuard,
  ],
  exports: [PropertiesService, PropertiesRepository],
})
export class PropertiesModule {}
