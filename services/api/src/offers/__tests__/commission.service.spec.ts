/**
 * CommissionService unit tests.
 */
describe('CommissionService', () => {
  describe('calculateHostFee', () => {
    it.todo('should calculate fee using integer arithmetic');
    it.todo('should truncate fractional cents');
    it.todo('should handle small amounts without negative results');
  });

  describe('calculateCleanerCommission', () => {
    it.todo('should calculate commission using integer arithmetic');
    it.todo('should always produce payout less than offered price');
  });

  describe('getFullBreakdown', () => {
    it.todo('should return consistent breakdown values');
    it.todo('should satisfy hostTotal = offeredPrice + hostFee');
    it.todo('should satisfy cleanerPayout = offeredPrice - cleanerCommission');
  });
});
