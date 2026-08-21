import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProfileService } from '../profile.service';
import { ProfileRepository } from '../profile.repository';
import { ProfilePhotoService } from '../photo/profile-photo.service';
import { User } from '../../auth/entities/user.entity';
import { HostProfile } from '../../roles/entities/host-profile.entity';
import { CleanerProfile } from '../../roles/entities/cleaner-profile.entity';

describe('ProfileService', () => {
  let service: ProfileService;
  let profileRepository: {
    findByUserId: jest.Mock;
    createProfile: jest.Mock;
    updateProfile: jest.Mock;
  };
  let profilePhotoService: { getSignedUrl: jest.Mock };
  let userRepository: { findOne: jest.Mock };
  let hostProfileRepository: { findOne: jest.Mock };
  let cleanerProfileRepository: { findOne: jest.Mock };

  const mockUser = {
    id: 'user-uuid-123',
    keycloakId: 'kc-id-abc',
    email: 'test@example.com',
    fullName: 'Test User',
    roles: ['host'],
    activeRole: 'host',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-15T00:00:00Z'),
  };

  const mockProfileDetails = {
    id: 'profile-uuid-456',
    userId: 'user-uuid-123',
    displayName: 'Test Display',
    phoneNumber: '+1234567890',
    photoStorageKey: 'user-uuid-123/avatar.jpg',
    bio: 'Hello world',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-10T00:00:00Z'),
  };

  const mockHostProfile = {
    id: 'host-uuid-789',
    userId: 'user-uuid-123',
    businessName: 'My Cleaning Business',
  };

  const mockCleanerProfile = {
    id: 'cleaner-uuid-101',
    userId: 'user-uuid-123',
    specialties: ['airbnb', 'offices'],
    workZoneLat: 4.711,
    workZoneLng: -74.0721,
    workZoneRadiusKm: 10,
    availability: {
      monday: { enabled: true, start: '08:00', end: '18:00' },
      tuesday: { enabled: true, start: '08:00', end: '18:00' },
      wednesday: { enabled: false, start: null, end: null },
      thursday: { enabled: true, start: '09:00', end: '17:00' },
      friday: { enabled: true, start: '08:00', end: '20:00' },
      saturday: { enabled: false, start: null, end: null },
      sunday: { enabled: false, start: null, end: null },
    },
  };

  beforeEach(async () => {
    profileRepository = {
      findByUserId: jest.fn(),
      createProfile: jest.fn(),
      updateProfile: jest.fn(),
    };

    profilePhotoService = {
      getSignedUrl: jest.fn(),
    };

    userRepository = { findOne: jest.fn() };
    hostProfileRepository = { findOne: jest.fn() };
    cleanerProfileRepository = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: ProfileRepository, useValue: profileRepository },
        { provide: ProfilePhotoService, useValue: profilePhotoService },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(HostProfile), useValue: hostProfileRepository },
        { provide: getRepositoryToken(CleanerProfile), useValue: cleanerProfileRepository },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPrivateProfile', () => {
    it('should return full profile with host fields when active role is host', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findByUserId.mockResolvedValue(mockProfileDetails);
      profilePhotoService.getSignedUrl.mockResolvedValue({
        url: 'https://minio.local/signed-url',
        expiresAt: new Date('2024-12-31T00:00:00Z'),
      });
      hostProfileRepository.findOne.mockResolvedValue(mockHostProfile);

      const result = await service.getPrivateProfile('kc-id-abc');

      expect(result.userId).toBe('user-uuid-123');
      expect(result.email).toBe('test@example.com');
      expect(result.displayName).toBe('Test Display');
      expect(result.phoneNumber).toBe('+1234567890');
      expect(result.photoUrl).toBe('https://minio.local/signed-url');
      expect(result.bio).toBe('Hello world');
      expect(result.activeRole).toBe('host');
      expect(result.roles).toEqual(['host']);
      expect(result.hostProfile).toEqual({ businessName: 'My Cleaning Business' });
      expect(result.cleanerProfile).toBeNull();
    });

    it('should return full profile with cleaner fields when active role is cleaner', async () => {
      const cleanerUser = {
        ...mockUser,
        roles: ['cleaner'],
        activeRole: 'cleaner',
      };

      userRepository.findOne.mockResolvedValue(cleanerUser);
      profileRepository.findByUserId.mockResolvedValue(mockProfileDetails);
      profilePhotoService.getSignedUrl.mockResolvedValue({
        url: 'https://minio.local/signed-url',
        expiresAt: new Date('2024-12-31T00:00:00Z'),
      });
      cleanerProfileRepository.findOne.mockResolvedValue(mockCleanerProfile);

      const result = await service.getPrivateProfile('kc-id-abc');

      expect(result.hostProfile).toBeNull();
      expect(result.cleanerProfile).toEqual({
        specialties: ['airbnb', 'offices'],
        workZoneCenter: { lat: 4.711, lng: -74.0721 },
        workZoneRadiusKm: 10,
        workZoneLabel: null,
        availability: mockCleanerProfile.availability,
      });
    });

    it('should return signed photo URL when photo exists', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findByUserId.mockResolvedValue(mockProfileDetails);
      profilePhotoService.getSignedUrl.mockResolvedValue({
        url: 'https://minio.local/presigned-photo-url',
        expiresAt: new Date('2024-12-31T00:00:00Z'),
      });
      hostProfileRepository.findOne.mockResolvedValue(mockHostProfile);

      const result = await service.getPrivateProfile('kc-id-abc');

      expect(profilePhotoService.getSignedUrl).toHaveBeenCalledWith(
        'user-uuid-123/avatar.jpg',
      );
      expect(result.photoUrl).toBe('https://minio.local/presigned-photo-url');
    });

    it('should return null photo URL when no photo storage key exists', async () => {
      const profileWithoutPhoto = {
        ...mockProfileDetails,
        photoStorageKey: null,
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findByUserId.mockResolvedValue(profileWithoutPhoto);
      hostProfileRepository.findOne.mockResolvedValue(mockHostProfile);

      const result = await service.getPrivateProfile('kc-id-abc');

      expect(profilePhotoService.getSignedUrl).not.toHaveBeenCalled();
      expect(result.photoUrl).toBeNull();
    });

    it('should create profile_details if not found for the user', async () => {
      const createdProfile = {
        id: 'new-profile-uuid',
        userId: 'user-uuid-123',
        displayName: '',
        phoneNumber: null,
        photoStorageKey: null,
        bio: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findByUserId.mockResolvedValue(null);
      profileRepository.createProfile.mockResolvedValue(createdProfile);
      hostProfileRepository.findOne.mockResolvedValue(null);

      const result = await service.getPrivateProfile('kc-id-abc');

      expect(profileRepository.createProfile).toHaveBeenCalledWith({
        userId: 'user-uuid-123',
        displayName: '',
        phoneNumber: null,
        photoStorageKey: null,
        bio: null,
      });
      expect(result.displayName).toBe('');
      expect(result.photoUrl).toBeNull();
    });

    it('should throw NotFoundException when user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getPrivateProfile('non-existent-kc-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return both host and cleaner profiles for dual-role user', async () => {
      const dualRoleUser = {
        ...mockUser,
        roles: ['host', 'cleaner'],
        activeRole: 'host',
      };

      userRepository.findOne.mockResolvedValue(dualRoleUser);
      profileRepository.findByUserId.mockResolvedValue(mockProfileDetails);
      profilePhotoService.getSignedUrl.mockResolvedValue({
        url: 'https://minio.local/signed-url',
        expiresAt: new Date('2024-12-31T00:00:00Z'),
      });
      hostProfileRepository.findOne.mockResolvedValue(mockHostProfile);
      cleanerProfileRepository.findOne.mockResolvedValue(mockCleanerProfile);

      const result = await service.getPrivateProfile('kc-id-abc');

      expect(result.hostProfile).toEqual({ businessName: 'My Cleaning Business' });
      expect(result.cleanerProfile).toEqual({
        specialties: ['airbnb', 'offices'],
        workZoneCenter: { lat: 4.711, lng: -74.0721 },
        workZoneRadiusKm: 10,
        workZoneLabel: null,
        availability: mockCleanerProfile.availability,
      });
    });

    it('should return null workZoneCenter when lat/lng are null', async () => {
      const cleanerWithNoZone = {
        ...mockCleanerProfile,
        workZoneLat: null,
        workZoneLng: null,
        workZoneRadiusKm: null,
      };

      const cleanerUser = {
        ...mockUser,
        roles: ['cleaner'],
        activeRole: 'cleaner',
      };

      userRepository.findOne.mockResolvedValue(cleanerUser);
      profileRepository.findByUserId.mockResolvedValue({
        ...mockProfileDetails,
        photoStorageKey: null,
      });
      cleanerProfileRepository.findOne.mockResolvedValue(cleanerWithNoZone);

      const result = await service.getPrivateProfile('kc-id-abc');

      expect(result.cleanerProfile!.workZoneCenter).toBeNull();
      expect(result.cleanerProfile!.workZoneRadiusKm).toBeNull();
    });
  });

  describe('updateCommonProfile', () => {
    const setupUpdateMocks = () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findByUserId.mockResolvedValue(mockProfileDetails);
      profileRepository.updateProfile.mockResolvedValue(mockProfileDetails);
      profilePhotoService.getSignedUrl.mockResolvedValue({
        url: 'https://minio.local/signed-url',
        expiresAt: new Date('2024-12-31T00:00:00Z'),
      });
      hostProfileRepository.findOne.mockResolvedValue(mockHostProfile);
    };

    it('should update display_name when provided', async () => {
      setupUpdateMocks();

      await service.updateCommonProfile('kc-id-abc', {
        displayName: 'New Name',
      });

      expect(profileRepository.updateProfile).toHaveBeenCalledWith(
        'user-uuid-123',
        { displayName: 'New Name' },
      );
    });

    it('should update phone_number when provided', async () => {
      setupUpdateMocks();

      await service.updateCommonProfile('kc-id-abc', {
        phoneNumber: '+573001234567',
      });

      expect(profileRepository.updateProfile).toHaveBeenCalledWith(
        'user-uuid-123',
        { phoneNumber: '+573001234567' },
      );
    });

    it('should update both fields together', async () => {
      setupUpdateMocks();

      await service.updateCommonProfile('kc-id-abc', {
        displayName: 'Updated Name',
        phoneNumber: '+14155552671',
      });

      expect(profileRepository.updateProfile).toHaveBeenCalledWith(
        'user-uuid-123',
        { displayName: 'Updated Name', phoneNumber: '+14155552671' },
      );
    });

    it('should throw BadRequestException when display_name is empty string', async () => {
      setupUpdateMocks();

      await expect(
        service.updateCommonProfile('kc-id-abc', { displayName: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateCommonProfile('non-existent-kc-id', {
          displayName: 'Name',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow null phone_number to clear the value', async () => {
      setupUpdateMocks();

      await service.updateCommonProfile('kc-id-abc', {
        phoneNumber: null as unknown as string,
      });

      expect(profileRepository.updateProfile).toHaveBeenCalledWith(
        'user-uuid-123',
        { phoneNumber: null },
      );
    });

    it('should return full PrivateProfile after update', async () => {
      setupUpdateMocks();

      const result = await service.updateCommonProfile('kc-id-abc', {
        displayName: 'New Name',
      });

      expect(result.userId).toBe('user-uuid-123');
      expect(result.email).toBe('test@example.com');
      expect(result.roles).toEqual(['host']);
      expect(result.hostProfile).toEqual({ businessName: 'My Cleaning Business' });
    });
  });
});
