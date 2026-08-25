/**
 * OffersService unit tests.
 */
describe('OffersService', () => {
  describe('create', () => {
    it.todo('should create an offer in DRAFT state');
    it.todo('should validate property readiness before creation');
    it.todo('should reject negative price');
    it.todo('should reject scheduled time without minimum lead');
    it.todo('should reject duplicate active offer for same property');
    it.todo('should support idempotency key');
  });

  describe('publish', () => {
    it.todo('should transition DRAFT → PUBLISHED');
    it.todo('should snapshot property data');
    it.todo('should enqueue initial delivery job');
  });

  describe('cancel', () => {
    it.todo('should cancel from DRAFT state');
    it.todo('should cancel from PUBLISHED state');
    it.todo('should cancel from ACTIVE state and notify Cleaners');
  });

  describe('findById', () => {
    it.todo('should return offer with state history');
    it.todo('should return null for non-existent offer');
  });

  describe('findByHostId', () => {
    it.todo('should return paginated results');
    it.todo('should filter by state');
  });
});
