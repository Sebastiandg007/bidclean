/**
 * DeliverySchedulerService unit tests.
 */
describe('DeliverySchedulerService', () => {
  describe('deliverToCleaners', () => {
    it.todo('should partition Cleaners by tier');
    it.todo('should deliver to Favorites first when enabled');
    it.todo('should attempt WebSocket delivery first');
    it.todo('should fall back to push on WebSocket failure');
    it.todo('should update delivery status to SENT on success');
    it.todo('should update delivery status to FAILED on all-channel failure');
  });

  describe('scheduleTierDelivery', () => {
    it.todo('should enqueue delayed job for PRO tier');
    it.todo('should enqueue delayed job for FREE tier');
  });
});
