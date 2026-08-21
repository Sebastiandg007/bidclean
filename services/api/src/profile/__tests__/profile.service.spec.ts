import { Test, TestingModule } from '@nestjs/testing';
import { ProfileService } from '../profile.service';
import { ProfileRepository } from '../profile.repository';

describe('ProfileService', () => {
  let service: ProfileService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: ProfileRepository, useValue: {} },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPrivateProfile', () => {
    it.todo('should return full private profile for authenticated user');
    it.todo('should include host-specific fields when user is Host');
    it.todo('should include cleaner-specific fields when user is Cleaner');
  });

  describe('getPublicProfile', () => {
    it.todo('should return only public fields');
    it.todo('should throw NotFoundException for non-existent user');
  });

  describe('updateCommonProfile', () => {
    it.todo('should update display name and phone number');
    it.todo('should validate phone number E.164 format');
  });
});
