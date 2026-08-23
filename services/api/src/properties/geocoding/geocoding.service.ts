import {
  Injectable,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ForwardGeocodeRequest,
  ForwardGeocodeResponse,
  ReverseGeocodeRequest,
  ReverseGeocodeResponse,
  MapboxFeature,
} from './geocoding.types';
import {
  GEOCODE_QUERY_MAX_LENGTH,
  SUPPORTED_COUNTRIES,
  MAPBOX_GEOCODING_BASE_URL,
  RATE_LIMIT_WINDOW_MS,
} from '../properties.constants';

/** Per-user rate limit tracking entry */
interface RateLimitEntry {
  readonly timestamps: number[];
}

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
  private readonly logger = new Logger(GeocodingService.name);
  private readonly accessToken: string;
  private readonly rateLimit: number;
  private readonly rateLimitMap = new Map<string, RateLimitEntry>();

  constructor(private readonly configService: ConfigService) {
    this.accessToken = this.configService.getOrThrow<string>('MAPBOX_ACCESS_TOKEN');
    this.rateLimit = Number(
      this.configService.getOrThrow<string>('PROPERTY_GEOCODING_RATE_LIMIT'),
    );
  }

  /**
   * Forward geocode an address string to coordinates.
   * Returns the best match from Mapbox, or null if geocoding fails (non-blocking).
   *
   * @throws BadRequestException if address exceeds max length or country is unsupported
   * @throws HttpException(429) if per-user rate limit is exceeded
   */
  async forwardGeocode(
    request: ForwardGeocodeRequest,
    userId: string,
  ): Promise<ForwardGeocodeResponse | null> {
    this.validateForwardRequest(request);
    this.checkRateLimit(userId);

    try {
      const encodedQuery = encodeURIComponent(request.address);
      const country = request.country.toLowerCase();
      const url =
        `${MAPBOX_GEOCODING_BASE_URL}/${encodedQuery}.json` +
        `?country=${country}&access_token=${this.accessToken}`;

      const response = await fetch(url);

      if (!response.ok) {
        this.logger.error(
          `Mapbox forward geocoding API error: ${response.status} ${response.statusText}`,
          { userId, address: request.address.substring(0, 50) },
        );
        return null;
      }

      const data = (await response.json()) as { features?: MapboxFeature[] };

      if (!data.features || data.features.length === 0) {
        this.logger.warn('Mapbox forward geocoding returned no results', {
          userId,
          address: request.address.substring(0, 50),
        });
        return null;
      }

      const bestMatch = data.features[0] as MapboxFeature;

      return {
        lng: bestMatch.center[0],
        lat: bestMatch.center[1],
        formattedAddress: bestMatch.place_name,
        confidence: bestMatch.relevance,
      };
    } catch (error) {
      this.logger.error('Forward geocoding failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Reverse geocode coordinates to a structured address.
   * Returns parsed address components, or null if geocoding fails (non-blocking).
   *
   * @throws BadRequestException if coordinates are out of valid range
   * @throws HttpException(429) if per-user rate limit is exceeded
   */
  async reverseGeocode(
    request: ReverseGeocodeRequest,
    userId: string,
  ): Promise<ReverseGeocodeResponse | null> {
    this.validateReverseRequest(request);
    this.checkRateLimit(userId);

    try {
      const url =
        `${MAPBOX_GEOCODING_BASE_URL}/${request.lng},${request.lat}.json` +
        `?access_token=${this.accessToken}`;

      const response = await fetch(url);

      if (!response.ok) {
        this.logger.error(
          `Mapbox reverse geocoding API error: ${response.status} ${response.statusText}`,
          { userId, lat: request.lat, lng: request.lng },
        );
        return null;
      }

      const data = (await response.json()) as { features?: MapboxFeature[] };

      if (!data.features || data.features.length === 0) {
        this.logger.warn('Mapbox reverse geocoding returned no results', {
          userId,
          lat: request.lat,
          lng: request.lng,
        });
        return null;
      }

      const bestMatch = data.features[0] as MapboxFeature;
      return this.parseReverseResponse(bestMatch);
    } catch (error) {
      this.logger.error('Reverse geocoding failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Validate forward geocode request inputs */
  private validateForwardRequest(request: ForwardGeocodeRequest): void {
    if (request.address.length > GEOCODE_QUERY_MAX_LENGTH) {
      throw new BadRequestException(
        `Address query exceeds maximum length of ${GEOCODE_QUERY_MAX_LENGTH} characters`,
      );
    }

    const upperCountry = request.country.toUpperCase();
    if (!SUPPORTED_COUNTRIES.includes(upperCountry as (typeof SUPPORTED_COUNTRIES)[number])) {
      throw new BadRequestException(
        `Unsupported country code: ${request.country}. Supported: ${SUPPORTED_COUNTRIES.join(', ')}`,
      );
    }
  }

  /** Validate reverse geocode request inputs */
  private validateReverseRequest(request: ReverseGeocodeRequest): void {
    if (request.lat < -90 || request.lat > 90) {
      throw new BadRequestException(
        'Latitude must be between -90 and 90',
      );
    }

    if (request.lng < -180 || request.lng > 180) {
      throw new BadRequestException(
        'Longitude must be between -180 and 180',
      );
    }
  }

  /** Check per-user rate limit and throw 429 if exceeded */
  private checkRateLimit(userId: string): void {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;

    const entry = this.rateLimitMap.get(userId);
    const timestamps = entry
      ? entry.timestamps.filter((ts) => ts > windowStart)
      : [];

    if (timestamps.length >= this.rateLimit) {
      throw new HttpException(
        'Geocoding rate limit exceeded. Please wait before making more requests.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    timestamps.push(now);
    this.rateLimitMap.set(userId, { timestamps });
  }

  /** Parse Mapbox reverse geocoding response into structured address */
  private parseReverseResponse(feature: MapboxFeature): ReverseGeocodeResponse {
    const context = feature.context ?? [];

    return {
      formattedAddress: feature.place_name,
      street: this.extractContextValue(context, 'address') ??
        this.extractContextValue(context, 'street') ??
        null,
      city: this.extractContextValue(context, 'place') ?? null,
      state: this.extractContextValue(context, 'region') ?? null,
      country: this.extractContextValue(context, 'country') ?? null,
      postalCode: this.extractContextValue(context, 'postcode') ?? null,
    };
  }

  /** Extract a value from Mapbox context array by id prefix */
  private extractContextValue(
    context: ReadonlyArray<{ id: string; text: string }>,
    idPrefix: string,
  ): string | undefined {
    const entry = context.find((c) => c.id.startsWith(`${idPrefix}.`));
    return entry?.text;
  }
}
