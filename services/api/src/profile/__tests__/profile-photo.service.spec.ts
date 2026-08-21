import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProfilePhotoService } from '../photo/profile-photo.service';

describe('ProfilePhotoService', () => {
  let service: ProfilePhotoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilePhotoService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<ProfilePhotoService>(ProfilePhotoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadPhoto', () => {
    it.todo('should upload photo to MinIO and return storage key');
    it.todo('should delete old photo on replacement');
    it.todo('should reject unsupported file types');
    it.todo('should reject files exceeding max size');
  });

  describe('deletePhoto', () => {
    it.todo('should delete photo from MinIO');
  });

  describe('getSignedUrl', () => {
    it.todo('should return signed URL with configurable expiry');
  });
});
