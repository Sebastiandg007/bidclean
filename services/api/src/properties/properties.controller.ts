/* eslint-disable @typescript-eslint/no-unused-vars -- Services injected for endpoint tasks 11-21 */
import { Controller, UseGuards } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertyPhotoService } from './photo/property-photo.service';
import { GeocodingService } from './geocoding/geocoding.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Properties controller.
 * Exposes endpoints for property CRUD, photo management,
 * geocoding proxies, and public property views.
 *
 * All endpoints require JWT authentication.
 * Mutation endpoints additionally require Host role + PropertyOwnerGuard.
 */
@Controller('properties')
@UseGuards(JwtAuthGuard)
export class PropertiesController {
  constructor(
    private readonly propertiesService: PropertiesService,
    private readonly propertyPhotoService: PropertyPhotoService,
    private readonly geocodingService: GeocodingService,
  ) {}

  // Endpoints implemented in tasks 11-21
}
