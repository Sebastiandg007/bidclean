import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PropertiesController } from '../properties.controller';
import { PropertiesService } from '../properties.service';
import { PropertyPhotoService } from '../photo/property-photo.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { PropertyOwnerGuard } from '../guards/property-owner.guard';
import { User } from '../../auth/entities/user.entity';
import { ReorderPhotosDto } from '../dto/reorder-photos.dto';

/** Mock guard that always allows access (unit tests isolate controller logic) */
const mockPropertyOwnerGuard = { canActivate: () => true };

describe('PropertiesController — PATCH /properties/:id/photos/order', () => {
  let controller: PropertiesController;
  let propertyPhotoService: { reorderPhotos: jest.Mock };

  const mockPropertyId = 'property-uuid-5678';

  beforeEach(async () => {
    propertyPhotoService = {
      reorderPhotos: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PropertiesController],
      providers: [
        { provide: PropertiesService, useValue: {} },
        { provide: PropertyPhotoService, useValue: propertyPhotoService },
        { provide: GeocodingService, useValue: {} },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
      ],
    })
      .overrideGuard(PropertyOwnerGuard)
      .useValue(mockPropertyOwnerGuard)
      .compile();

    controller = module.get<PropertiesController>(PropertiesController);
  });

  it('should call propertyPhotoService.reorderPhotos with correct arguments', async () => {
    const dto: ReorderPhotosDto = {
      photoIds: [
        'aaaaaaaa-1111-4000-a000-000000000001',
        'aaaaaaaa-1111-4000-a000-000000000002',
        'aaaaaaaa-1111-4000-a000-000000000003',
      ],
    };

    const result = await controller.reorderPhotos(mockPropertyId, dto);

    expect(propertyPhotoService.reorderPhotos).toHaveBeenCalledWith(
      mockPropertyId,
      dto.photoIds,
    );
    expect(result).toEqual({ message: 'property.photos.reordered' });
  });

  it('should return 200 OK with success message', async () => {
    const dto: ReorderPhotosDto = {
      photoIds: ['aaaaaaaa-1111-4000-a000-000000000001'],
    };

    const result = await controller.reorderPhotos(mockPropertyId, dto);

    expect(result.message).toBe('property.photos.reordered');
  });

  it('should propagate BadRequestException from service when photo ID not found', async () => {
    propertyPhotoService.reorderPhotos.mockRejectedValueOnce(
      new BadRequestException('property.error.photo_not_found'),
    );

    const dto: ReorderPhotosDto = {
      photoIds: ['aaaaaaaa-1111-4000-a000-nonexistent01'],
    };

    await expect(controller.reorderPhotos(mockPropertyId, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should propagate BadRequestException when photo count does not match', async () => {
    propertyPhotoService.reorderPhotos.mockRejectedValueOnce(
      new BadRequestException('property.error.photo_not_found'),
    );

    const dto: ReorderPhotosDto = {
      photoIds: ['aaaaaaaa-1111-4000-a000-000000000001'],
    };

    await expect(controller.reorderPhotos(mockPropertyId, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should pass propertyId from route param correctly', async () => {
    const customPropertyId = 'custom-property-uuid-999';
    const dto: ReorderPhotosDto = {
      photoIds: ['aaaaaaaa-1111-4000-a000-000000000001'],
    };

    await controller.reorderPhotos(customPropertyId, dto);

    expect(propertyPhotoService.reorderPhotos).toHaveBeenCalledWith(
      customPropertyId,
      dto.photoIds,
    );
  });

  it('should handle single photo ID in array', async () => {
    const dto: ReorderPhotosDto = {
      photoIds: ['aaaaaaaa-1111-4000-a000-000000000001'],
    };

    const result = await controller.reorderPhotos(mockPropertyId, dto);

    expect(propertyPhotoService.reorderPhotos).toHaveBeenCalledTimes(1);
    expect(result.message).toBe('property.photos.reordered');
  });

  it('should handle multiple photo IDs preserving order', async () => {
    const orderedIds = [
      'aaaaaaaa-1111-4000-a000-000000000003',
      'aaaaaaaa-1111-4000-a000-000000000001',
      'aaaaaaaa-1111-4000-a000-000000000002',
    ];
    const dto: ReorderPhotosDto = { photoIds: orderedIds };

    await controller.reorderPhotos(mockPropertyId, dto);

    expect(propertyPhotoService.reorderPhotos).toHaveBeenCalledWith(
      mockPropertyId,
      orderedIds,
    );
  });
});
