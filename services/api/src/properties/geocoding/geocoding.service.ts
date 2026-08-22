import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Geocoding service.
 * Server-side proxy to Mapbox Geocoding API v5.
 *
 * Forward geocoding: address text → lat/lng (max input length from constants, country filtering).
 * Reverse geocoding: lat/lng → structured address (coordinate validation).
 *
 * The Mapbox access token is kept server-side (env: MAPBOX_ACCESS_TOKEN).
 * Per-user rate limiting prevents abuse (env: PROPERTY_GEOCODING_RATE_LIMIT).
 * Failures are non-blocking — the user can always fall back to manual pin placement.
 */
@Injectable()
export class GeocodingService {
  constructor(private readonly _configService: ConfigService) {}

  /** @internal Placeholder to satisfy noUnusedLocals until methods are implemented */
  protected get dependencies(): unknown[] {
    return [this._configService];
  }
}
