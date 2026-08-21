import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AccountService } from '../account/account.service';

describe('AccountService', () => {
  let service: AccountService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getEmailChangeUrl', () => {
    it.todo('should return Keycloak email change URL');
  });

  describe('getPasswordChangeUrl', () => {
    it.todo('should return Keycloak password change URL');
  });

  describe('requestAccountDeletion', () => {
    it.todo('should validate confirmation word');
    it.todo('should reject when active services exist');
    it.todo('should mark user as DELETION_PENDING');
    it.todo('should enqueue BullMQ deletion job');
  });
});
