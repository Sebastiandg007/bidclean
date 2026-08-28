import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NegotiationController } from '../negotiation.controller';
import { NegotiationService } from '../negotiation.service';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../roles/roles.types';

/**
 * Unit tests for NegotiationController.
 *
 * Feature: offer-negotiation
 * Validates JWT/role resolution, the mandatory Idempotency-Key (400 when missing),
 * and delegation to the service.
 */
describe('NegotiationController', () => {
  let controller: NegotiationController;
  let service: jest.Mocked<NegotiationService>;
  let userRepo: { findOne: jest.Mock };

  const cleanerUser = {
    id: 'cleaner-id',
    keycloakId: 'kc-cleaner',
    roles: [UserRole.CLEANER],
  };
  const hostUser = { id: 'host-id', keycloakId: 'kc-host', roles: [UserRole.HOST] };

  function req(keycloakId: string) {
    return { user: { keycloakId, email: 'x@test.com', emailVerified: true } } as never;
  }

  beforeEach(async () => {
    service = {
      acceptOffer: jest.fn().mockResolvedValue({ offerId: 'o1' }),
      createCounteroffer: jest.fn().mockResolvedValue({ id: 'p1' }),
      acceptProposal: jest.fn().mockResolvedValue({ offerId: 'o1' }),
      rejectProposal: jest.fn().mockResolvedValue({ id: 'p1' }),
      counterProposal: jest.fn().mockResolvedValue({ id: 'p2' }),
      getThreadForCleaner: jest.fn().mockResolvedValue(null),
      getHostInbox: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<NegotiationService>;

    userRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NegotiationController],
      providers: [
        { provide: NegotiationService, useValue: service },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    controller = module.get<NegotiationController>(NegotiationController);
  });

  describe('acceptOffer', () => {
    it('requires an Idempotency-Key (400 when missing)', async () => {
      userRepo.findOne.mockResolvedValue(cleanerUser);
      await expect(controller.acceptOffer(req('kc-cleaner'), 'o1', undefined)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.acceptOffer).not.toHaveBeenCalled();
    });

    it('requires the Cleaner role', async () => {
      userRepo.findOne.mockResolvedValue(hostUser);
      await expect(controller.acceptOffer(req('kc-host'), 'o1', 'key-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('delegates to the service with the resolved cleaner id', async () => {
      userRepo.findOne.mockResolvedValue(cleanerUser);
      await controller.acceptOffer(req('kc-cleaner'), 'o1', 'key-1');
      expect(service.acceptOffer).toHaveBeenCalledWith('cleaner-id', 'o1', 'key-1');
    });
  });

  describe('createCounteroffer', () => {
    it('requires an Idempotency-Key', async () => {
      userRepo.findOne.mockResolvedValue(cleanerUser);
      await expect(
        controller.createCounteroffer(req('kc-cleaner'), 'o1', { proposedPriceCents: 9000 }, ''),
      ).rejects.toThrow(BadRequestException);
    });

    it('delegates to the service', async () => {
      userRepo.findOne.mockResolvedValue(cleanerUser);
      await controller.createCounteroffer(
        req('kc-cleaner'),
        'o1',
        { proposedPriceCents: 9000 },
        'key-2',
      );
      expect(service.createCounteroffer).toHaveBeenCalledWith(
        'cleaner-id',
        'o1',
        { proposedPriceCents: 9000 },
        'key-2',
      );
    });
  });

  describe('acceptProposal', () => {
    it('allows either Host or Cleaner role', async () => {
      userRepo.findOne.mockResolvedValue(hostUser);
      await controller.acceptProposal(req('kc-host'), 'p1', 'key-3');
      expect(service.acceptProposal).toHaveBeenCalledWith('host-id', 'p1', 'key-3');
    });

    it('rejects a user with neither role', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'x', keycloakId: 'kc-x', roles: [] });
      await expect(controller.acceptProposal(req('kc-x'), 'p1', 'key-3')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getHostInbox', () => {
    it('requires the Host role and delegates', async () => {
      userRepo.findOne.mockResolvedValue(hostUser);
      await controller.getHostInbox(req('kc-host'));
      expect(service.getHostInbox).toHaveBeenCalledWith('host-id');
    });
  });
});
