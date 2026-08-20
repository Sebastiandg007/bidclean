import { HttpException, HttpStatus } from '@nestjs/common';
import { KycStatus } from '../kyc.types';

/**
 * Thrown when a state transition is not allowed by the state machine.
 * E.g., NOT_STARTED → PROCESSING (skipping DOCUMENT_UPLOADED).
 */
export class InvalidStateTransitionError extends HttpException {
  constructor(from: KycStatus, to: KycStatus) {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'Invalid State Transition',
        message: `Cannot transition from ${from} to ${to}`,
        from,
        to,
      },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * Thrown when a concurrent update conflicts with the expected state.
 * Uses optimistic locking: UPDATE ... WHERE status = :expected fails.
 */
export class StateConflictError extends HttpException {
  constructor(verificationId: string, expectedStatus: KycStatus) {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'State Conflict',
        message: `Verification ${verificationId} was modified concurrently. Expected status: ${expectedStatus}`,
        verificationId,
        expectedStatus,
      },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * Thrown when a user has exceeded the maximum KYC verification attempts.
 */
export class MaxAttemptsExceededError extends HttpException {
  constructor(userId: string, maxAttempts: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Max Attempts Exceeded',
        message: `User ${userId} has reached the maximum of ${maxAttempts} verification attempts`,
        userId,
        maxAttempts,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Thrown when a guard precondition is not met for a state transition.
 * E.g., transitioning to DOCUMENT_UPLOADED without a document storage key.
 */
export class TransitionGuardError extends HttpException {
  constructor(guardName: string, reason: string) {
    super(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Transition Guard Failed',
        message: `Guard "${guardName}" failed: ${reason}`,
        guard: guardName,
        reason,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
