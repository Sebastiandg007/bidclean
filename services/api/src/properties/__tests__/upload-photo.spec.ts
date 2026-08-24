import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PropertiesController } from '../properties.controller';
import { PropertiesService } from '../properties.service';
import { PropertyPhotoService } from '../photo/property-photo.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { PropertyOwnerGuard } from '../guards/property-owner.guard';
import { PhotoUploadResult } from '../photo/property-photo.types';
import { User } from '../../auth/entities/user.entity';
import { Response } from 'express';

/** Mock guard that always allows access (unit tests isolate controller logic) */
const mockPropertyOwnerGuard = { canActivate: () => true };

describe('PropertiesController — POST /:id/photos', () => {
  let controller: PropertiesController;
  let photoService: { uploadPhoto: jest.Mock };
  let mockResponse: Partial<Response>;

  const mockPropertyId = 'property-uuid-1234';

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'photo.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    buffer: Buffer.from('fake-jpeg-data'),
    size: 1024,
    stream: null as never,
    destination: '',
    filename: '',
    path: '',
  };

  const mockUploadResult: PhotoUploadResult = {
    id: 'photo-uuid-5678',
    storageKey: `${mockPropertyId}/photo-uuid-5678.jpg`,
    mimeType: 'image/jpeg',
    fileSizeBytes: 900,
    displayOrder: 0,
    signedUrl: 'https://minio.local/signed-url?token=abc',
  };

  beforeEach(async () => {
    photoService = {
      uploadPhoto: jest.fn(),
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PropertiesController],
      providers: [
        { provide: PropertiesService, useValue: {} },
        { provide: PropertyPhotoService, useValue: photoService },
        { provide: GeocodingService, useValue: {} },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
      ],
    })
      .overrideGuard(PropertyOwnerGuard)
      .useValue(mockPropertyOwnerGuard)
      .compile();

    controller = module.get<PropertiesController>(PropertiesController);
  });

  it('should upload a photo and return 201 for a new upload', async () => {
    photoService.uploadPhoto.mockResolvedValueOnce(mockUploadResult);

    const result = await controller.uploadPhoto(
      mockPropertyId,
      mockFile,
      undefined,
      mockResponse as Response,
    );

    expect(result).toEqual(mockUploadResult);
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CREATED);
    expect(photoService.uploadPhoto).toHaveBeenCalledWith(
      mockPropertyId,
      mockFile.buffer,
      mockFile.mimetype,
      undefined,
    );
  });

  it('should return 200 when idempotency key matches an existing upload', async () => {
    const idempotencyKey = 'idem-key-abc';
    const idempotentResult: PhotoUploadResult = {
      ...mockUploadResult,
      storageKey: `${mockPropertyId}/${idempotencyKey}`,
    };
    photoService.uploadPhoto.mockResolvedValueOnce(idempotentResult);

    const result = await controller.uploadPhoto(
      mockPropertyId,
      mockFile,
      idempotencyKey,
      mockResponse as Response,
    );

    expect(result).toEqual(idempotentResult);
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('should return 201 when idempotency key is provided but no duplicate exists', async () => {
    const idempotencyKey = 'new-idem-key';
    photoService.uploadPhoto.mockResolvedValueOnce(mockUploadResult);

    const result = await controller.uploadPhoto(
      mockPropertyId,
      mockFile,
      idempotencyKey,
      mockResponse as Response,
    );

    expect(result).toEqual(mockUploadResult);
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CREATED);
  });

  it('should throw BadRequestException when no file is provided', async () => {
    await expect(
      controller.uploadPhoto(
        mockPropertyId,
        undefined,
        undefined,
        mockResponse as Response,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(photoService.uploadPhoto).not.toHaveBeenCalled();
  });

  it('should propagate BadRequestException for invalid MIME type from service', async () => {
    photoService.uploadPhoto.mockRejectedValueOnce(
      new BadRequestException('property.error.invalid_photo_format'),
    );

    const invalidFile = { ...mockFile, mimetype: 'application/pdf' };

    await expect(
      controller.uploadPhoto(
        mockPropertyId,
        invalidFile,
        undefined,
        mockResponse as Response,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should propagate PayloadTooLargeException for oversized files from service', async () => {
    photoService.uploadPhoto.mockRejectedValueOnce(
      new PayloadTooLargeException('property.error.photo_too_large'),
    );

    await expect(
      controller.uploadPhoto(
        mockPropertyId,
        mockFile,
        undefined,
        mockResponse as Response,
      ),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it('should propagate BadRequestException when max photos reached from service', async () => {
    photoService.uploadPhoto.mockRejectedValueOnce(
      new BadRequestException('property.error.max_photos_reached'),
    );

    await expect(
      controller.uploadPhoto(
        mockPropertyId,
        mockFile,
        undefined,
        mockResponse as Response,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should pass the file buffer and mimetype to the photo service', async () => {
    const pngFile: Express.Multer.File = {
      ...mockFile,
      mimetype: 'image/png',
      buffer: Buffer.from('fake-png-data'),
    };
    photoService.uploadPhoto.mockResolvedValueOnce(mockUploadResult);

    await controller.uploadPhoto(
      mockPropertyId,
      pngFile,
      undefined,
      mockResponse as Response,
    );

    expect(photoService.uploadPhoto).toHaveBeenCalledWith(
      mockPropertyId,
      pngFile.buffer,
      'image/png',
      undefined,
    );
  });

  it('should pass the idempotency key to the photo service', async () => {
    const idempotencyKey = 'unique-key-xyz';
    photoService.uploadPhoto.mockResolvedValueOnce(mockUploadResult);

    await controller.uploadPhoto(
      mockPropertyId,
      mockFile,
      idempotencyKey,
      mockResponse as Response,
    );

    expect(photoService.uploadPhoto).toHaveBeenCalledWith(
      mockPropertyId,
      mockFile.buffer,
      mockFile.mimetype,
      idempotencyKey,
    );
  });
});
