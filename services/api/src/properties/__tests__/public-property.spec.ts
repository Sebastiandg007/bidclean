import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PropertiesService } from '../properties.service';
import { PropertiesController } from '../properties.controller';
import { PropertiesRepository } from '../properties.repository';
import { PropertyPhotoService } from '../photo/property-photo.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { PropertyOwnerGuard } from '../guards/property-owner.guard';
import { OFFER_EDITABILITY_CHECK, PROPERTY_READINESS_CHECK } from '../contracts/offer-editability.interface';
import { User } from '../../auth/entities/user.entity';
import { PublicPropertyView } from '../properties.types';

/** Mock guard that always allows access (unit tests isolate controller logic) */
const mockPropertyOwnerGuard = { canActivate: () => true };

describe('GET /properties/:id/public', () => {
  describe('PropertiesService.getPublicProperty', () => {
    let service: PropertiesService;
    let repository: { findPublicProperty: jest.Mock };
    let photoService: { getSignedUrl: jest.Mock };

    const mockPropertyId = 'property-uuid-5678';

    const mockRawProperty: Record<string, unknown> = {
      id: mockPropertyId,
      name: 'My Apartment',
      type: 'apartment',
      description: 'A nice place',
      addressCity: 'Bogotá',
      addressCountry: 'CO',
      squareMeters: 80,
      bedrooms: 2,
      bathrooms: 1,
      floorNumber: 3,
      hasParking: true,
      hasElevator: false,
      specialRequirements: ['eco_products'],
      checklistItems: ['Clean kitchen', 'Mop floors'],
      photos: [
        {
          id: 'photo-uuid-1',
          storageKey: 'property-uuid-5678/photo-uuid-1.jpg',
          mimeType: 'image/jpeg',
          fileSizeBytes: 204800,
          displayOrder: 0,
        },
        {
          id: 'photo-uuid-2',
          storageKey: 'property-uuid-5678/photo-uuid-2.png',
          mimeType: 'image/png',
          fileSizeBytes: 102400,
          displayOrder: 1,
        },
      ],
    };

    beforeEach(async () => {
      repository = {
        findPublicProperty: jest.fn(),
      };

      photoService = {
        getSignedUrl: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PropertiesService,
          { provide: PropertiesRepository, useValue: repository },
          { provide: PropertyPhotoService, useValue: photoService },
          { provide: GeocodingService, useValue: {} },
          { provide: OFFER_EDITABILITY_CHECK, useValue: { canModifyProperty: jest.fn() } },
          { provide: PROPERTY_READINESS_CHECK, useValue: { isOfferReady: jest.fn().mockResolvedValue({ ready: true, reasons: [] }) } },
          { provide: DataSource, useValue: { query: jest.fn() } },
        ],
      }).compile();

      service = module.get<PropertiesService>(PropertiesService);
    });

    it('should return public property view with photos and signed URLs', async () => {
      repository.findPublicProperty.mockResolvedValueOnce({ ...mockRawProperty });
      photoService.getSignedUrl.mockResolvedValueOnce({ url: 'https://minio/signed-url-1', expiresAt: new Date() });
      photoService.getSignedUrl.mockResolvedValueOnce({ url: 'https://minio/signed-url-2', expiresAt: new Date() });

      const result = await service.getPublicProperty(mockPropertyId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(mockPropertyId);
      expect(result!.name).toBe('My Apartment');
      expect(result!.type).toBe('apartment');
      expect(result!.description).toBe('A nice place');
      expect(result!.city).toBe('Bogotá');
      expect(result!.country).toBe('CO');
      expect(result!.dimensions).toEqual({
        squareMeters: 80,
        bedrooms: 2,
        bathrooms: 1,
        floorNumber: 3,
      });
      expect(result!.amenities).toEqual({
        hasParking: true,
        hasElevator: false,
        specialRequirements: ['eco_products'],
      });
      expect(result!.checklistItems).toEqual(['Clean kitchen', 'Mop floors']);
      expect(result!.photos).toHaveLength(2);
      expect(result!.photos[0]!.url).toBe('https://minio/signed-url-1');
      expect(result!.photos[1]!.url).toBe('https://minio/signed-url-2');
    });

    it('should return null for non-existent property', async () => {
      repository.findPublicProperty.mockResolvedValueOnce(null);

      const result = await service.getPublicProperty('non-existent-id');

      expect(result).toBeNull();
      expect(photoService.getSignedUrl).not.toHaveBeenCalled();
    });

    it('should NOT include private fields in the response', async () => {
      repository.findPublicProperty.mockResolvedValueOnce({ ...mockRawProperty });
      photoService.getSignedUrl.mockResolvedValue({ url: 'https://minio/url', expiresAt: new Date() });

      const result = await service.getPublicProperty(mockPropertyId) as unknown as Record<string, unknown>;

      expect(result).not.toBeNull();
      // These fields must NEVER exist in the public view
      expect(result!['addressStreet']).toBeUndefined();
      expect(result!['address_street']).toBeUndefined();
      expect(result!['addressState']).toBeUndefined();
      expect(result!['address_state']).toBeUndefined();
      expect(result!['addressPostalCode']).toBeUndefined();
      expect(result!['address_postal_code']).toBeUndefined();
      expect(result!['formattedAddress']).toBeUndefined();
      expect(result!['formatted_address']).toBeUndefined();
      expect(result!['location']).toBeUndefined();
      expect(result!['locationSource']).toBeUndefined();
      expect(result!['location_source']).toBeUndefined();
      expect(result!['accessInstructions']).toBeUndefined();
      expect(result!['access_instructions']).toBeUndefined();
    });

    it('should generate signed URLs for each photo', async () => {
      repository.findPublicProperty.mockResolvedValueOnce({ ...mockRawProperty });
      photoService.getSignedUrl.mockResolvedValueOnce({ url: 'https://minio/signed-1', expiresAt: new Date() });
      photoService.getSignedUrl.mockResolvedValueOnce({ url: 'https://minio/signed-2', expiresAt: new Date() });

      await service.getPublicProperty(mockPropertyId);

      expect(photoService.getSignedUrl).toHaveBeenCalledTimes(2);
      expect(photoService.getSignedUrl).toHaveBeenCalledWith('property-uuid-5678/photo-uuid-1.jpg');
      expect(photoService.getSignedUrl).toHaveBeenCalledWith('property-uuid-5678/photo-uuid-2.png');
    });

    it('should handle property with no photos', async () => {
      const noPhotos = { ...mockRawProperty, photos: [] };
      repository.findPublicProperty.mockResolvedValueOnce(noPhotos);

      const result = await service.getPublicProperty(mockPropertyId);

      expect(result).not.toBeNull();
      expect(result!.photos).toEqual([]);
      expect(photoService.getSignedUrl).not.toHaveBeenCalled();
    });

    it('should handle null description and null floorNumber', async () => {
      const nullFields = { ...mockRawProperty, description: null, floorNumber: null, photos: [] };
      repository.findPublicProperty.mockResolvedValueOnce(nullFields);

      const result = await service.getPublicProperty(mockPropertyId);

      expect(result).not.toBeNull();
      expect(result!.description).toBeNull();
      expect(result!.dimensions.floorNumber).toBeNull();
    });
  });

  describe('PropertiesController.getPublicProperty', () => {
    let controller: PropertiesController;
    let propertiesService: { getPublicProperty: jest.Mock };

    const mockPropertyId = 'property-uuid-5678';

    const mockPublicView: PublicPropertyView = {
      id: mockPropertyId,
      name: 'My Apartment',
      type: 'apartment',
      description: 'A nice place',
      city: 'Bogotá',
      country: 'CO',
      dimensions: {
        squareMeters: 80,
        bedrooms: 2,
        bathrooms: 1,
        floorNumber: 3,
      },
      amenities: {
        hasParking: true,
        hasElevator: false,
        specialRequirements: ['eco_products'],
      },
      checklistItems: ['Clean kitchen', 'Mop floors'],
      photos: [
        {
          id: 'photo-uuid-1',
          url: 'https://minio/signed-url-1',
          mimeType: 'image/jpeg',
          fileSizeBytes: 204800,
          displayOrder: 0,
        },
      ],
    };

    beforeEach(async () => {
      propertiesService = {
        getPublicProperty: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [PropertiesController],
        providers: [
          { provide: PropertiesService, useValue: propertiesService },
          { provide: PropertyPhotoService, useValue: {} },
          { provide: GeocodingService, useValue: {} },
          { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
        ],
      })
        .overrideGuard(PropertyOwnerGuard)
        .useValue(mockPropertyOwnerGuard)
        .compile();

      controller = module.get<PropertiesController>(PropertiesController);
    });

    it('should return public property view when property exists', async () => {
      propertiesService.getPublicProperty.mockResolvedValueOnce(mockPublicView);

      const result = await controller.getPublicProperty(mockPropertyId);

      expect(result).toEqual(mockPublicView);
      expect(propertiesService.getPublicProperty).toHaveBeenCalledWith(mockPropertyId);
    });

    it('should throw NotFoundException when property not found', async () => {
      propertiesService.getPublicProperty.mockResolvedValueOnce(null);

      await expect(
        controller.getPublicProperty(mockPropertyId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not require user resolution (no ownership check)', async () => {
      propertiesService.getPublicProperty.mockResolvedValueOnce(mockPublicView);

      // The public endpoint does not call resolveUserId — it only passes the propertyId
      const result = await controller.getPublicProperty(mockPropertyId);

      expect(result).toBeDefined();
      expect(propertiesService.getPublicProperty).toHaveBeenCalledWith(mockPropertyId);
    });
  });
});
