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
import {
  OFFER_EDITABILITY_CHECK,
  DefaultOfferEditabilityCheck,
  PROPERTY_READINESS_CHECK,
} from './contracts/offer-editability.interface';
import { DefaultPropertyReadinessCheck } from './contracts/property-readiness.service';
import { RolesModule } from '../roles/roles.module';

/**
 * Properties module.
 *
 * Manages property CRUD for Hosts: creation with idempotency,
 * photo management (MinIO AES-256 encryption, transactional ordering),
 * geocoding (Mapbox forward/reverse via server-side proxy),
 * PostGIS spatial storage with location_source tracking,
 * address privacy enforcement via dedicated SELECT queries,
 * and offer-readiness calculation.
 *
 * The OfferEditabilityCheck contract is provided via DI token so it can be
 * swapped with a real implementation when the offer-publishing spec is built.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Property, PropertyPhoto, User]),
    RolesModule,
  ],
  controllers: [PropertiesController],
  providers: [
    PropertiesService,
    PropertiesRepository,
    PropertyPhotoService,
    GeocodingService,
    PropertyOwnerGuard,
    {
      provide: OFFER_EDITABILITY_CHECK,
      useClass: DefaultOfferEditabilityCheck,
    },
    {
      provide: PROPERTY_READINESS_CHECK,
      useClass: DefaultPropertyReadinessCheck,
    },
  ],
  exports: [
    PropertiesService,
    PropertiesRepository,
    OFFER_EDITABILITY_CHECK,
    PROPERTY_READINESS_CHECK,
  ],
})
export class PropertiesModule {}
