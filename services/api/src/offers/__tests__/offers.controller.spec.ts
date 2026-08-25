/**
 * OffersController unit tests.
 */
describe('OffersController', () => {
  describe('POST /offers', () => {
    it.todo('should create an offer and return 201');
    it.todo('should require authentication');
    it.todo('should require Host role');
  });

  describe('POST /offers/:id/publish', () => {
    it.todo('should publish an offer and return 200');
    it.todo('should enforce ownership via OfferOwnerGuard');
  });

  describe('POST /offers/:id/cancel', () => {
    it.todo('should cancel an offer and return 200');
  });

  describe('GET /offers', () => {
    it.todo('should return paginated offer list');
    it.todo('should support state filter query param');
  });

  describe('GET /offers/:id', () => {
    it.todo('should return offer detail with state history');
    it.todo('should return 404 for non-existent offer');
  });

  describe('GET /offers/:id/price-breakdown', () => {
    it.todo('should return price breakdown for Host view');
    it.todo('should return price breakdown for Cleaner view');
  });
});
