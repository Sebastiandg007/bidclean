/**
 * OffersController unit tests.
 *
 * Exercises role resolution, delegation to OffersService, and error mapping.
 * (Concurrency/atomicity + state-transition audit invariants are covered by the
 * companion property specs.)
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OffersController } from '../offers.controller';
import { OfferState } from '../offers.types';
import { UserRole } from '../../roles/roles.types';

describe('OffersController', () => {
  let controller: OffersController;
  let offersService: {
    create: jest.Mock;
    publish: jest.Mock;
    cancel: jest.Mock;
    findByHostId: jest.Mock;
    findById: jest.Mock;
    getPriceBreakdown: jest.Mock;
  };
  let userRepository: { findOne: jest.Mock };

  const hostUser = { id: 'user-1', keycloakId: 'kc-1', roles: [UserRole.HOST], activeRole: UserRole.HOST };
  const req = (keycloakId = 'kc-1') => ({ user: { keycloakId } }) as never;

  beforeEach(() => {
    offersService = {
      create: jest.fn().mockResolvedValue({ id: 'offer-1' }),
      publish: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn().mockResolvedValue(undefined),
      findByHostId: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      findById: jest.fn().mockResolvedValue({ id: 'offer-1' }),
      getPriceBreakdown: jest.fn().mockResolvedValue({ view: 'host' }),
    };
    userRepository = { findOne: jest.fn().mockResolvedValue(hostUser) };
    controller = new OffersController(offersService as never, userRepository as never);
  });

  describe('POST /offers', () => {
    it('should create an offer and return its id', async () => {
      const dto = { propertyId: 'p1', serviceType: 'standard', offeredPriceCents: 5000 } as never;
      const result = await controller.create(req(), dto, 'idem-1');
      expect(result).toEqual({ id: 'offer-1' });
      expect(offersService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ idempotencyKey: 'idem-1' }),
      );
    });

    it('should require Host role', async () => {
      userRepository.findOne.mockResolvedValue({ ...hostUser, roles: [UserRole.CLEANER] });
      await expect(controller.create(req(), {} as never, undefined)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('should reject an unknown user', async () => {
      userRepository.findOne.mockResolvedValue(null);
      await expect(controller.create(req(), {} as never, undefined)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('POST /offers/:id/publish', () => {
    it('should publish an offer via the service', async () => {
      await controller.publish(req(), 'offer-1', { favoritesFirst: true } as never);
      expect(offersService.publish).toHaveBeenCalledWith('offer-1', 'user-1', {
        favoritesFirst: true,
      });
    });
  });

  describe('POST /offers/:id/cancel', () => {
    it('should cancel an offer via the service', async () => {
      await controller.cancel(req(), 'offer-1');
      expect(offersService.cancel).toHaveBeenCalledWith('offer-1', 'user-1');
    });
  });

  describe('GET /offers', () => {
    it('should return the paginated offer list', async () => {
      const result = await controller.findAll(req(), undefined, '1', '20');
      expect(result.total).toBe(0);
      expect(offersService.findByHostId).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ page: 1, pageSize: 20 }),
      );
    });

    it('should pass a valid state filter through', async () => {
      await controller.findAll(req(), 'active', undefined, undefined);
      expect(offersService.findByHostId).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ state: OfferState.ACTIVE }),
      );
    });

    it('should ignore an invalid state filter', async () => {
      await controller.findAll(req(), 'not-a-state', undefined, undefined);
      expect(offersService.findByHostId).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ state: undefined }),
      );
    });
  });

  describe('GET /offers/:id', () => {
    it('should return offer detail', async () => {
      const result = await controller.findOne(req(), 'offer-1');
      expect(result).toEqual({ id: 'offer-1' });
      expect(offersService.findById).toHaveBeenCalledWith('offer-1', 'user-1');
    });

    it('should return 404 for a non-existent offer', async () => {
      offersService.findById.mockResolvedValue(null);
      await expect(controller.findOne(req(), 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('GET /offers/:id/price-breakdown', () => {
    it('should return the Host-view breakdown for a Host', async () => {
      await controller.getPriceBreakdown(req(), 'offer-1');
      expect(offersService.getPriceBreakdown).toHaveBeenCalledWith('offer-1', 'user-1', UserRole.HOST);
    });

    it('should return the Cleaner-view breakdown for an active Cleaner', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-2',
        keycloakId: 'kc-2',
        roles: [UserRole.CLEANER],
        activeRole: UserRole.CLEANER,
      });
      await controller.getPriceBreakdown(req('kc-2'), 'offer-1');
      expect(offersService.getPriceBreakdown).toHaveBeenCalledWith(
        'offer-1',
        'user-2',
        UserRole.CLEANER,
      );
    });
  });
});
