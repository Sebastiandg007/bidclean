import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { PaymentsController } from '../payments.controller';
import { UserRole } from '../../roles/roles.types';

describe('PaymentsController', () => {
  function buildController() {
    const paymentsService = {
      startCleanerOnboarding: jest.fn().mockResolvedValue({ onboardingUrl: 'https://x' }),
      getCleanerAccountStatus: jest.fn().mockResolvedValue({ hasAccount: true }),
      getPaymentForOffer: jest.fn().mockResolvedValue({ id: 'pay-1' }),
      refund: jest.fn().mockResolvedValue({ id: 'pay-1' }),
    };
    const userRepository = { findOne: jest.fn() };
    const controller = new PaymentsController(paymentsService as never, userRepository as never);
    return { controller, paymentsService, userRepository };
  }

  const req = (keycloakId = 'kc-1') => ({ user: { keycloakId } }) as never;

  it('starts onboarding for a Cleaner', async () => {
    const { controller, userRepository, paymentsService } = buildController();
    userRepository.findOne.mockResolvedValue({ id: 'u1', roles: [UserRole.CLEANER] });
    await controller.startOnboarding(req());
    expect(paymentsService.startCleanerOnboarding).toHaveBeenCalledWith('u1');
  });

  it('rejects onboarding for a non-Cleaner (403)', async () => {
    const { controller, userRepository } = buildController();
    userRepository.findOne.mockResolvedValue({ id: 'u1', roles: [UserRole.HOST] });
    await expect(controller.startOnboarding(req())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unknown user (403)', async () => {
    const { controller, userRepository } = buildController();
    userRepository.findOne.mockResolvedValue(null);
    await expect(controller.getAccountStatus(req())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows Host or Cleaner to read a payment', async () => {
    const { controller, userRepository, paymentsService } = buildController();
    userRepository.findOne.mockResolvedValue({ id: 'u1', roles: [UserRole.HOST] });
    await controller.getPayment(req(), 'offer-1');
    expect(paymentsService.getPaymentForOffer).toHaveBeenCalledWith('u1', 'offer-1');
  });

  it('requires an Idempotency-Key on refund (400)', async () => {
    const { controller, userRepository } = buildController();
    userRepository.findOne.mockResolvedValue({ id: 'u1', roles: [UserRole.HOST] });
    await expect(
      controller.refund(req(), 'offer-1', { amountCents: 100 }, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refunds as a Host with an idempotency key', async () => {
    const { controller, userRepository, paymentsService } = buildController();
    userRepository.findOne.mockResolvedValue({ id: 'u1', roles: [UserRole.HOST] });
    await controller.refund(req(), 'offer-1', { amountCents: 500 }, 'idem-1');
    expect(paymentsService.refund).toHaveBeenCalledWith(
      'u1',
      'offer-1',
      { amountCents: 500 },
      'idem-1',
    );
  });

  it('rejects refund for a non-Host (403)', async () => {
    const { controller, userRepository } = buildController();
    userRepository.findOne.mockResolvedValue({ id: 'u1', roles: [UserRole.CLEANER] });
    await expect(
      controller.refund(req(), 'offer-1', {}, 'idem-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
