import { DisputeService } from '../disputes/dispute.service';
import { DisputeStatus } from '../payments.types';

describe('DisputeService', () => {
  function buildDeps() {
    const repo = { findPaymentById: jest.fn(), setDisputeStatus: jest.fn() };
    const publisher = { emitDisputed: jest.fn() };
    const service = new DisputeService(repo as never, publisher as never);
    return { service, repo, publisher };
  }

  const payment = {
    id: 'pay-1',
    offerId: 'offer-1',
    hostId: 'host-1',
    cleanerId: 'cleaner-1',
    disputeStatus: DisputeStatus.NONE,
  };

  it('opens a dispute (orthogonal status) and emits payment.disputed (P5, P12)', async () => {
    const { service, repo, publisher } = buildDeps();
    repo.findPaymentById.mockResolvedValue({ ...payment });
    await service.openDispute('pay-1');
    expect(repo.setDisputeStatus).toHaveBeenCalledWith('pay-1', DisputeStatus.OPEN);
    expect(publisher.emitDisputed).toHaveBeenCalledTimes(1);
  });

  it('is idempotent when already open', async () => {
    const { service, repo } = buildDeps();
    repo.findPaymentById.mockResolvedValue({ ...payment, disputeStatus: DisputeStatus.OPEN });
    await service.openDispute('pay-1');
    expect(repo.setDisputeStatus).not.toHaveBeenCalled();
  });

  it('closes a dispute as WON', async () => {
    const { service, repo } = buildDeps();
    repo.findPaymentById.mockResolvedValue({ ...payment, disputeStatus: DisputeStatus.OPEN });
    await service.closeDispute('pay-1', true);
    expect(repo.setDisputeStatus).toHaveBeenCalledWith('pay-1', DisputeStatus.WON);
  });

  it('closes a dispute as LOST', async () => {
    const { service, repo } = buildDeps();
    repo.findPaymentById.mockResolvedValue({ ...payment, disputeStatus: DisputeStatus.OPEN });
    await service.closeDispute('pay-1', false);
    expect(repo.setDisputeStatus).toHaveBeenCalledWith('pay-1', DisputeStatus.LOST);
  });

  it('ignores a close when not open (out-of-order guard)', async () => {
    const { service, repo } = buildDeps();
    repo.findPaymentById.mockResolvedValue({ ...payment, disputeStatus: DisputeStatus.NONE });
    await service.closeDispute('pay-1', true);
    expect(repo.setDisputeStatus).not.toHaveBeenCalled();
  });
});
