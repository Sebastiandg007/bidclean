import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeocodingService } from '../geocoding/geocoding.service';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('GeocodingService', () => {
  let service: GeocodingService;

  const MOCK_ACCESS_TOKEN = 'pk.test-token-12345';
  const MOCK_RATE_LIMIT = '30';
  const USER_ID = 'user-uuid-1';

  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      const config: Record<string, string> = {
        MAPBOX_ACCESS_TOKEN: MOCK_ACCESS_TOKEN,
        PROPERTY_GEOCODING_RATE_LIMIT: MOCK_RATE_LIMIT,
      };
      return config[key];
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GeocodingService(mockConfigService);
  });

  describe('forwardGeocode', () => {
    const validRequest = { address: 'Cra 7 #71-21, Bogotá', country: 'CO' };

    const mockMapboxResponse = {
      features: [
        {
          place_name: 'Carrera 7 #71-21, Bogotá, Colombia',
          center: [-74.0536, 4.6486],
          relevance: 0.95,
          context: [],
        },
      ],
    };

    it('should return coordinates for a valid address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMapboxResponse,
      });

      const result = await service.forwardGeocode(validRequest, USER_ID);

      expect(result).toEqual({
        lat: 4.6486,
        lng: -74.0536,
        formattedAddress: 'Carrera 7 #71-21, Bogotá, Colombia',
        confidence: 0.95,
      });
    });

    it('should call Mapbox API with correct URL parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMapboxResponse,
      });

      await service.forwardGeocode(validRequest, USER_ID);

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain(encodeURIComponent(validRequest.address));
      expect(calledUrl).toContain('country=co');
      expect(calledUrl).toContain(`access_token=${MOCK_ACCESS_TOKEN}`);
    });

    it('should return null when API returns no results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ features: [] }),
      });

      const result = await service.forwardGeocode(validRequest, USER_ID);

      expect(result).toBeNull();
    });

    it('should return null when API returns non-ok status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await service.forwardGeocode(validRequest, USER_ID);

      expect(result).toBeNull();
    });

    it('should return null when network error occurs', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await service.forwardGeocode(validRequest, USER_ID);

      expect(result).toBeNull();
    });

    it('should throw BadRequestException when address exceeds 300 chars', async () => {
      const longAddress = 'A'.repeat(301);

      await expect(
        service.forwardGeocode({ address: longAddress, country: 'CO' }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for unsupported country', async () => {
      await expect(
        service.forwardGeocode({ address: 'Some address', country: 'ZZ' }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept all supported country codes', async () => {
      const countries = ['CO', 'US', 'CA', 'GB', 'DE', 'FR', 'IT', 'ES', 'PT', 'NL'];

      for (const country of countries) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockMapboxResponse,
        });

        const result = await service.forwardGeocode(
          { address: 'Test', country },
          USER_ID,
        );

        expect(result).not.toBeNull();
      }
    });
  });

  describe('reverseGeocode', () => {
    const validRequest = { lat: 4.6486, lng: -74.0536 };

    const mockMapboxReverseResponse = {
      features: [
        {
          place_name: 'Carrera 7 #71-21, Bogotá, Cundinamarca, Colombia',
          center: [-74.0536, 4.6486],
          relevance: 1.0,
          context: [
            { id: 'address.123', text: 'Carrera 7 #71-21' },
            { id: 'place.456', text: 'Bogotá' },
            { id: 'region.789', text: 'Cundinamarca' },
            { id: 'country.012', text: 'Colombia' },
            { id: 'postcode.345', text: '110231' },
          ],
        },
      ],
    };

    it('should return structured address for valid coordinates', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMapboxReverseResponse,
      });

      const result = await service.reverseGeocode(validRequest, USER_ID);

      expect(result).toEqual({
        formattedAddress: 'Carrera 7 #71-21, Bogotá, Cundinamarca, Colombia',
        street: 'Carrera 7 #71-21',
        city: 'Bogotá',
        state: 'Cundinamarca',
        country: 'Colombia',
        postalCode: '110231',
      });
    });

    it('should call Mapbox API with lng,lat order in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMapboxReverseResponse,
      });

      await service.reverseGeocode(validRequest, USER_ID);

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain(`${validRequest.lng},${validRequest.lat}.json`);
      expect(calledUrl).toContain(`access_token=${MOCK_ACCESS_TOKEN}`);
    });

    it('should return null fields when context entries are missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              place_name: 'Unknown Place',
              center: [-74.0536, 4.6486],
              relevance: 0.5,
              context: [],
            },
          ],
        }),
      });

      const result = await service.reverseGeocode(validRequest, USER_ID);

      expect(result).toEqual({
        formattedAddress: 'Unknown Place',
        street: null,
        city: null,
        state: null,
        country: null,
        postalCode: null,
      });
    });

    it('should return null when API returns no results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ features: [] }),
      });

      const result = await service.reverseGeocode(validRequest, USER_ID);

      expect(result).toBeNull();
    });

    it('should return null when API returns non-ok status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const result = await service.reverseGeocode(validRequest, USER_ID);

      expect(result).toBeNull();
    });

    it('should return null when network error occurs', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

      const result = await service.reverseGeocode(validRequest, USER_ID);

      expect(result).toBeNull();
    });

    it('should throw BadRequestException when lat is below -90', async () => {
      await expect(
        service.reverseGeocode({ lat: -91, lng: 0 }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when lat is above 90', async () => {
      await expect(
        service.reverseGeocode({ lat: 91, lng: 0 }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when lng is below -180', async () => {
      await expect(
        service.reverseGeocode({ lat: 0, lng: -181 }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when lng is above 180', async () => {
      await expect(
        service.reverseGeocode({ lat: 0, lng: 181 }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept boundary coordinate values', async () => {
      const boundaryCoords = [
        { lat: 90, lng: 180 },
        { lat: -90, lng: -180 },
        { lat: 0, lng: 0 },
      ];

      for (const coords of boundaryCoords) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockMapboxReverseResponse,
        });

        const result = await service.reverseGeocode(coords, USER_ID);
        expect(result).not.toBeNull();
      }
    });
  });

  describe('rate limiting', () => {
    it('should throw HttpException 429 when rate limit is exceeded', async () => {
      // Create a service with a very low rate limit for testing
      const lowLimitConfig = {
        getOrThrow: jest.fn((key: string) => {
          const config: Record<string, string> = {
            MAPBOX_ACCESS_TOKEN: MOCK_ACCESS_TOKEN,
            PROPERTY_GEOCODING_RATE_LIMIT: '3',
          };
          return config[key];
        }),
      } as unknown as ConfigService;

      const limitedService = new GeocodingService(lowLimitConfig);
      const request = { address: 'Test address', country: 'CO' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              place_name: 'Test',
              center: [-74.0, 4.6],
              relevance: 0.9,
              context: [],
            },
          ],
        }),
      });

      // Make 3 successful requests (at the limit)
      await limitedService.forwardGeocode(request, USER_ID);
      await limitedService.forwardGeocode(request, USER_ID);
      await limitedService.forwardGeocode(request, USER_ID);

      // 4th request should throw 429
      try {
        await limitedService.forwardGeocode(request, USER_ID);
        fail('Expected HttpException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    });

    it('should track rate limits per user independently', async () => {
      const lowLimitConfig = {
        getOrThrow: jest.fn((key: string) => {
          const config: Record<string, string> = {
            MAPBOX_ACCESS_TOKEN: MOCK_ACCESS_TOKEN,
            PROPERTY_GEOCODING_RATE_LIMIT: '2',
          };
          return config[key];
        }),
      } as unknown as ConfigService;

      const limitedService = new GeocodingService(lowLimitConfig);
      const request = { address: 'Test address', country: 'CO' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              place_name: 'Test',
              center: [-74.0, 4.6],
              relevance: 0.9,
              context: [],
            },
          ],
        }),
      });

      // User A makes 2 requests
      await limitedService.forwardGeocode(request, 'user-a');
      await limitedService.forwardGeocode(request, 'user-a');

      // User B should still be able to make requests
      const result = await limitedService.forwardGeocode(request, 'user-b');
      expect(result).not.toBeNull();

      // User A should be rate limited
      await expect(
        limitedService.forwardGeocode(request, 'user-a'),
      ).rejects.toThrow(HttpException);
    });

    it('should apply rate limiting to reverse geocode as well', async () => {
      const lowLimitConfig = {
        getOrThrow: jest.fn((key: string) => {
          const config: Record<string, string> = {
            MAPBOX_ACCESS_TOKEN: MOCK_ACCESS_TOKEN,
            PROPERTY_GEOCODING_RATE_LIMIT: '2',
          };
          return config[key];
        }),
      } as unknown as ConfigService;

      const limitedService = new GeocodingService(lowLimitConfig);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              place_name: 'Test',
              center: [-74.0, 4.6],
              relevance: 1.0,
              context: [],
            },
          ],
        }),
      });

      // Mix forward and reverse to fill the limit
      await limitedService.forwardGeocode({ address: 'Test', country: 'CO' }, USER_ID);
      await limitedService.reverseGeocode({ lat: 4.6, lng: -74.0 }, USER_ID);

      // Third request should be rate limited
      await expect(
        limitedService.reverseGeocode({ lat: 4.6, lng: -74.0 }, USER_ID),
      ).rejects.toThrow(HttpException);
    });
  });
});
