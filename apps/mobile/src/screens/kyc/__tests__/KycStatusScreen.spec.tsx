/**
 * Tests for KycStatusScreen.
 *
 * Covers: status display per state, retry button visibility, verified callback.
 *
 * Implementation in Task 25.
 */

describe('KycStatusScreen', () => {
  it.todo('displays processing state with loading indicator');
  it.todo('displays verified state with success message');
  it.todo('displays rejected state with rejection reason');
  it.todo('shows retry button when status is REJECTED');
  it.todo('hides retry button when status is PROCESSING or VERIFIED');
  it.todo('calls onRetry when retry button is pressed');
  it.todo('calls onVerified when status transitions to VERIFIED');
  it.todo('polls server for status updates while PROCESSING');
});
