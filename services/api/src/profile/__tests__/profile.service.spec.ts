import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
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
  let hostProfileRepository: { findOne: jest.Mock; save: jest.Mock };
  let cleanerProfileRepository: { findOne: jest.Mock; save: jest.Mock };

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
    hostProfileRepository = { findOne: jest.fn(), save: jest.fn() };
    cleanerProfileRepository = { findOne: jest.fn(), save: jest.fn() };

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

  describe('updateHostProfile', () => {
    const setupHostUpdateMocks = () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findByUserId.mockResolvedValue(mockProfileDetails);
      profilePhotoService.getSignedUrl.mockResolvedValue({
        url: 'https://minio.local/signed-url',
        expiresAt: new Date('2024-12-31T00:00:00Z'),
      });
      hostProfileRepository.findOne.mockResolvedValue(mockHostProfile);
      hostProfileRepository.save.mockResolvedValue(mockHostProfile);
    };

    it('should update business_name when provided', async () => {
      setupHostUpdateMocks();

      await service.updateHostProfile('kc-id-abc', {
        businessName: 'New Business Name',
      });

      expect(hostProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ businessName: 'New Business Name' }),
      );
    });

    it('should throw ForbiddenException when user does not have host role', async () => {
      const cleanerOnlyUser = {
        ...mockUser,
        roles: ['cleaner'],
        activeRole: 'cleaner',
      };
      userRepository.findOne.mockResolvedValue(cleanerOnlyUser);

      await expect(
        service.updateHostProfile('kc-id-abc', { businessName: 'Test' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when host profile not found', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      hostProfileRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateHostProfile('kc-id-abc', { businessName: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return full PrivateProfile after update', async () => {
      setupHostUpdateMocks();

      const result = await service.updateHostProfile('kc-id-abc', {
        businessName: 'Updated Business',
      });

      expect(result.userId).toBe('user-uuid-123');
      expect(result.email).toBe('test@example.com');
      expect(result.roles).toEqual(['host']);
      expect(result.hostProfile).toEqual({ businessName: 'Updated Business' });
    });

    it('should allow null businessName to clear the value', async () => {
      setupHostUpdateMocks();

      await service.updateHostProfile('kc-id-abc', {
        businessName: null as unknown as string,
      });

      expect(hostProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ businessName: null }),
      );
    });
  });

  describe('updateCleanerProfile', () => {
    const cleanerUser = {
      ...mockUser,
      roles: ['cleaner'],
      activeRole: 'cleaner',
    };

    const validAvailability = {
      monday: { enabled: true, start: '08:00', end: '18:00' },
      tuesday: { enabled: true, start: '08:00', end: '18:00' },
      wednesday: { enabled: false, start: null, end: null },
      thursday: { enabled: true, start: '09:00', end: '17:00' },
      friday: { enabled: true, start: '08:00', end: '20:00' },
      saturday: { enabled: false, start: null, end: null },
      sunday: { enabled: false, start: null, end: null },
    };

    const setupCleanerUpdateMocks = () => {
      userRepository.findOne.mockResolvedValue(cleanerUser);
      profileRepository.findByUserId.mockResolvedValue(mockProfileDetails);
      profileRepository.updateProfile.mockResolvedValue(mockProfileDetails);
      profilePhotoService.getSignedUrl.mockResolvedValue({
        url: 'https://minio.local/signed-url',
        expiresAt: new Date('2024-12-31T00:00:00Z'),
      });
      cleanerProfileRepository.findOne.mockResolvedValue({ ...mockCleanerProfile });
      cleanerProfileRepository.save.mockResolvedValue(mockCleanerProfile);
    };

    it('should update specialties when provided', async () => {
      setupCleanerUpdateMocks();

      await service.updateCleanerProfile('kc-id-abc', {
        specialties: ['airbnb', 'offices', 'homes'],
      });

      expect(cleanerProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ specialties: ['airbnb', 'offices', 'homes'] }),
      );
    });

    it('should update work zone center (lat/lng) and radius when provided', async () => {
      setupCleanerUpdateMocks();

      await service.updateCleanerProfile('kc-id-abc', {
        workZoneCenter: { lat: 40.7128, lng: -74.006 },
        workZoneRadiusKm: 15,
      });

      expect(cleanerProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          workZoneLat: 40.7128,
          workZoneLng: -74.006,
          workZoneRadiusKm: 15,
        }),
      );
    });

    it('should update availability when provided with valid schema', async () => {
      setupCleanerUpdateMocks();

      await service.updateCleanerProfile('kc-id-abc', {
        availability: validAvailability,
      });

      expect(cleanerProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ availability: validAvailability }),
      );
    });

    it('should update bio in profile_details when provided', async () => {
      setupCleanerUpdateMocks();

      await service.updateCleanerProfile('kc-id-abc', {
        bio: 'I am a professional cleaner with 5 years of experience.',
      });

      expect(profileRepository.updateProfile).toHaveBeenCalledWith(
        'user-uuid-123',
        { bio: 'I am a professional cleaner with 5 years of experience.' },
      );
    });

    it('should throw ForbiddenException when user does not have cleaner role', async () => {
      const hostOnlyUser = {
        ...mockUser,
        roles: ['host'],
        activeRole: 'host',
      };
      userRepository.findOne.mockResolvedValue(hostOnlyUser);

      await expect(
        service.updateCleanerProfile('kc-id-abc', {
          specialties: ['airbnb'],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when cleaner profile not found', async () => {
      userRepository.findOne.mockResolvedValue(cleanerUser);
      cleanerProfileRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateCleanerProfile('kc-id-abc', {
          specialties: ['airbnb'],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when availability has invalid schema', async () => {
      setupCleanerUpdateMocks();

      const invalidAvailability = {
        monday: { enabled: true, start: null, end: null },
        tuesday: { enabled: true, start: '08:00', end: '18:00' },
        wednesday: { enabled: false, start: null, end: null },
        thursday: { enabled: false, start: null, end: null },
        friday: { enabled: false, start: null, end: null },
        saturday: { enabled: false, start: null, end: null },
        sunday: { enabled: false, start: null, end: null },
      };

      await expect(
        service.updateCleanerProfile('kc-id-abc', {
          availability: invalidAvailability as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when availability has non-null times for disabled day', async () => {
      setupCleanerUpdateMocks();

      const invalidAvailability = {
        monday: { enabled: false, start: '08:00', end: '18:00' },
        tuesday: { enabled: false, start: null, end: null },
        wednesday: { enabled: false, start: null, end: null },
        thursday: { enabled: false, start: null, end: null },
        friday: { enabled: false, start: null, end: null },
        saturday: { enabled: false, start: null, end: null },
        sunday: { enabled: false, start: null, end: null },
      };

      await expect(
        service.updateCleanerProfile('kc-id-abc', {
          availability: invalidAvailability as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when bio exceeds max length', async () => {
      setupCleanerUpdateMocks();

      const longBio = 'a'.repeat(2001);

      await expect(
        service.updateCleanerProfile('kc-id-abc', { bio: longBio }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return full PrivateProfile after update', async () => {
      setupCleanerUpdateMocks();

      const result = await service.updateCleanerProfile('kc-id-abc', {
        specialties: ['airbnb'],
      });

      expect(result.userId).toBe('user-uuid-123');
      expect(result.email).toBe('test@example.com');
      expect(result.roles).toEqual(['cleaner']);
      expect(result.cleanerProfile).not.toBeNull();
    });

    it('should allow partial updates (only specialties without other fields)', async () => {
      setupCleanerUpdateMocks();

      await service.updateCleanerProfile('kc-id-abc', {
        specialties: ['homes'],
      });

      expect(cleanerProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ specialties: ['homes'] }),
      );
      expect(profileRepository.updateProfile).not.toHaveBeenCalled();
    });
  });
});
