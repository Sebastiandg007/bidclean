import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProfileService } from '../profile.service';
import { ProfileRepository } from '../profile.repository';
import { ProfilePhotoService } from '../photo/profile-photo.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../auth/entities/user.entity';
import { HostProfile } from '../../roles/entities/host-profile.entity';
import { CleanerProfile } from '../../roles/entities/cleaner-profile.entity';
import { PublicProfileRow } from '../profile.types';

describe('ProfileService — getPublicProfile', () => {
  let service: ProfileService;
  let profileRepository: {
    findByUserId: jest.Mock;
    createProfile: jest.Mock;
    updateProfile: jest.Mock;
    findPublicProfile: jest.Mock;
  };
  let profilePhotoService: { getSignedUrl: jest.Mock };
  let userRepository: { findOne: jest.Mock };
  let hostProfileRepository: { findOne: jest.Mock; save: jest.Mock };
  let cleanerProfileRepository: { findOne: jest.Mock; save: jest.Mock };

  const mockMemberSince = new Date('2024-01-01T00:00:00Z');

  const mockPublicProfileRow: PublicProfileRow = {
    userId: 'user-uuid-123',
    displayName: 'María López',
    photoStorageKey: 'user-uuid-123/avatar.jpg',
    bio: 'Professional cleaner with 5 years of experience.',
    memberSince: mockMemberSince,
    specialties: ['airbnb', 'offices'],
    isKycVerified: true,
  };

  beforeEach(async () => {
    profileRepository = {
      findByUserId: jest.fn(),
      createProfile: jest.fn(),
      updateProfile: jest.fn(),
      findPublicProfile: jest.fn(),
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

  it('should return only public fields for an existing user', async () => {
    profileRepository.findPublicProfile.mockResolvedValue(mockPublicProfileRow);
    profilePhotoService.getSignedUrl.mockResolvedValue({
      url: 'https://storage.local/signed-avatar-url',
      expiresAt: new Date('2024-12-31T00:00:00Z'),
    });

    const result = await service.getPublicProfile('user-uuid-123');

    expect(result.userId).toBe('user-uuid-123');
    expect(result.displayName).toBe('María López');
    expect(result.bio).toBe('Professional cleaner with 5 years of experience.');
    expect(result.memberSince).toEqual(mockMemberSince);
    expect(result.specialties).toEqual(['airbnb', 'offices']);
    expect(result.isKycVerified).toBe(true);
    expect(result.workZoneLabel).toBeNull();
    expect(result.photoUrl).toBe('https://storage.local/signed-avatar-url');

    // Verify no private fields are present
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('phoneNumber');
    expect(result).not.toHaveProperty('settings');
    expect(result).not.toHaveProperty('workZoneCenter');
  });

  it('should throw NotFoundException for non-existent user', async () => {
    profileRepository.findPublicProfile.mockResolvedValue(null);

    await expect(
      service.getPublicProfile('non-existent-uuid'),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.getPublicProfile('non-existent-uuid'),
    ).rejects.toThrow('profile.error.user_not_found');
  });

  it('should resolve signed photo URL when photo exists', async () => {
    profileRepository.findPublicProfile.mockResolvedValue(mockPublicProfileRow);
    profilePhotoService.getSignedUrl.mockResolvedValue({
      url: 'https://storage.local/presigned-photo',
      expiresAt: new Date('2024-12-31T00:00:00Z'),
    });

    const result = await service.getPublicProfile('user-uuid-123');

    expect(profilePhotoService.getSignedUrl).toHaveBeenCalledWith(
      'user-uuid-123/avatar.jpg',
    );
    expect(result.photoUrl).toBe('https://storage.local/presigned-photo');
  });

  it('should return null photo URL when no photo exists', async () => {
    const rowWithoutPhoto: PublicProfileRow = {
      ...mockPublicProfileRow,
      photoStorageKey: null,
    };

    profileRepository.findPublicProfile.mockResolvedValue(rowWithoutPhoto);

    const result = await service.getPublicProfile('user-uuid-123');

    expect(profilePhotoService.getSignedUrl).not.toHaveBeenCalled();
    expect(result.photoUrl).toBeNull();
  });

  it('should return isKycVerified true when latest verification is VERIFIED', async () => {
    const verifiedRow: PublicProfileRow = {
      ...mockPublicProfileRow,
      isKycVerified: true,
    };

    profileRepository.findPublicProfile.mockResolvedValue(verifiedRow);
    profilePhotoService.getSignedUrl.mockResolvedValue({
      url: 'https://storage.local/signed-url',
      expiresAt: new Date(),
    });

    const result = await service.getPublicProfile('user-uuid-123');

    expect(result.isKycVerified).toBe(true);
  });

  it('should return isKycVerified false when no verification exists', async () => {
    const unverifiedRow: PublicProfileRow = {
      ...mockPublicProfileRow,
      isKycVerified: false,
    };

    profileRepository.findPublicProfile.mockResolvedValue(unverifiedRow);
    profilePhotoService.getSignedUrl.mockResolvedValue({
      url: 'https://storage.local/signed-url',
      expiresAt: new Date(),
    });

    const result = await service.getPublicProfile('user-uuid-123');

    expect(result.isKycVerified).toBe(false);
  });

  it('should return specialties for cleaner users', async () => {
    profileRepository.findPublicProfile.mockResolvedValue(mockPublicProfileRow);
    profilePhotoService.getSignedUrl.mockResolvedValue({
      url: 'https://storage.local/signed-url',
      expiresAt: new Date(),
    });

    const result = await service.getPublicProfile('user-uuid-123');

    expect(result.specialties).toEqual(['airbnb', 'offices']);
  });

  it('should return null specialties for host-only users', async () => {
    const hostOnlyRow: PublicProfileRow = {
      ...mockPublicProfileRow,
      specialties: null,
    };

    profileRepository.findPublicProfile.mockResolvedValue(hostOnlyRow);
    profilePhotoService.getSignedUrl.mockResolvedValue({
      url: 'https://storage.local/signed-url',
      expiresAt: new Date(),
    });

    const result = await service.getPublicProfile('user-uuid-123');

    expect(result.specialties).toBeNull();
  });

  it('should always return null for workZoneLabel (not yet implemented)', async () => {
    profileRepository.findPublicProfile.mockResolvedValue(mockPublicProfileRow);
    profilePhotoService.getSignedUrl.mockResolvedValue({
      url: 'https://storage.local/signed-url',
      expiresAt: new Date(),
    });

    const result = await service.getPublicProfile('user-uuid-123');

    expect(result.workZoneLabel).toBeNull();
  });
});
